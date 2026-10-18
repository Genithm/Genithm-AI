from __future__ import annotations

import hashlib
import io
import json
import os
import shutil
from contextlib import contextmanager
from dataclasses import asdict, replace
from pathlib import Path
from uuid import uuid4

import pytest

from app.bulk_transfer import (BulkTransfer, CompletionUncertain, GIB, MIB, MAX_OBJECT_BYTES,
                               ObjectInfo, Part, Plan, RetryableTransferError, Scope,
                               TransferError, fingerprint, verify_stream)

SCOPE = Scope(*[str(uuid4()) for _ in range(4)])


class DiskStore:
    """Independent test transport: persists all bytes, never a whole-file buffer."""
    binding = "loopback-disk-fixture-v1"

    def __init__(self, root: Path):
        self.root = root
        root.mkdir(exist_ok=True)
        self.upload_calls = []
        self.complete_calls = 0
        self.create_calls = 0
        self.max_write = 0
        self.fail_part_once = None
        self.completion_ack_lost = False
        self.complete_without_writing = False
        self.corrupt_on_complete = False
        self.last_stream = None

    def target(self, key):
        return self.root / key

    def head(self, key):
        path = self.target(key)
        if not path.is_file():
            return None
        meta = json.loads(path.with_suffix('.json').read_text())
        return ObjectInfo(path.stat().st_size, '"opaque-test-etag"', meta)

    def create(self, key, metadata):
        self.create_calls += 1
        upload_id = str(uuid4())
        d = self.root / upload_id
        d.mkdir()
        (d / 'metadata').write_text(json.dumps(metadata))
        return upload_id

    def list_parts(self, key, upload_id):
        directory = self.root / upload_id
        return [Part(int(p.name), p.stat().st_size,
                     hashlib.md5(p.read_bytes(), usedforsecurity=False).hexdigest())
                for p in sorted(directory.iterdir()) if p.name.isdigit()]

    def upload(self, key, upload_id, number, data):
        self.upload_calls.append(number)
        if self.fail_part_once == number:
            self.fail_part_once = None
            raise RetryableTransferError('injected transient error')
        self.max_write = max(self.max_write, len(data))
        (self.root / upload_id / str(number)).write_bytes(data)
        return hashlib.md5(data, usedforsecurity=False).hexdigest()

    def complete(self, key, upload_id, parts):
        self.complete_calls += 1
        if self.complete_without_writing:
            raise RetryableTransferError('injected failure before storage')
        path = self.target(key)
        path.parent.mkdir(parents=True, exist_ok=True)
        with path.open('wb') as out:
            for p in parts:
                with (self.root / upload_id / str(p.number)).open('rb') as src:
                    shutil.copyfileobj(src, out, length=MIB)
        shutil.copyfile(self.root / upload_id / 'metadata', path.with_suffix('.json'))
        shutil.rmtree(self.root / upload_id)
        if self.corrupt_on_complete:
            with path.open('r+b') as f:
                f.write(b'CORRUPT')
        if self.completion_ack_lost:
            raise RetryableTransferError('injected lost completion reply')

    def abort(self, key, upload_id):
        shutil.rmtree(self.root / upload_id)

    @contextmanager
    def open(self, key, etag):
        assert etag == '"opaque-test-etag"'
        with self.target(key).open('rb') as stream:
            self.last_stream = stream
            yield stream


def source_file(root: Path, size: int):
    path = root / 'input.bin'
    block = bytes(range(256)) * 4096
    with path.open('wb') as f:
        left = size
        while left:
            f.write(block[:min(left, len(block))])
            left -= min(left, len(block))
    return path


@pytest.mark.parametrize('size', [True, False, 0, -1, 1.1, MAX_OBJECT_BYTES + 1])
def test_reject_invalid_size_without_allocation(size):
    with pytest.raises(TransferError):
        Plan(size)


@pytest.mark.parametrize('part_size,workers', [(4*MIB, 1), (65*MIB, 1), (16*MIB, 0), (16*MIB, 5), (16*MIB, True)])
def test_bounded_parts_and_parallelism(part_size, workers):
    with pytest.raises(TransferError):
        Plan(GIB, part_size, workers)


def test_gigabyte_arithmetic_without_large_buffers():
    p = Plan(10*GIB + 3)
    assert p.parts == 641
    assert p.length(641) == 3
    assert p.length(640) == 16*MIB
    assert Plan(100*GIB).parts == 6400
    with pytest.raises(TransferError):
        Plan(100*GIB, 5*MIB)
    with pytest.raises(TransferError):
        p.length(642)


def test_transfer_all_bytes_and_private_checkpoint(tmp_path):
    size = 12*MIB + 13
    src = source_file(tmp_path, size)
    store = DiskStore(tmp_path / 'objectstore')
    cp = tmp_path / 'checkpoint.json'
    events = []
    receipt = BulkTransfer(store).run(src, cp, SCOPE, Plan(size, 5*MIB, 2),
                                      lambda *args: events.append(args))
    assert receipt.size == size and receipt.parts == 3
    assert receipt.sha256 == hashlib.sha256(src.read_bytes()).hexdigest()
    assert store.max_write == 5*MIB
    assert store.last_stream.closed
    assert cp.stat().st_mode & 0o777 == 0o600
    state = json.loads(cp.read_text())
    assert state['stage'] == 'verified'
    assert 'input.bin' not in cp.read_text()
    assert events[-1] == ('verifying', size, size)
    assert store.target(SCOPE.key).read_bytes() == src.read_bytes()


def test_resume_after_interruption_rechecks_source_and_remote_parts(tmp_path):
    size = 12*MIB
    src = source_file(tmp_path, size)
    store = DiskStore(tmp_path / 's3')
    cp = tmp_path / 'checkpoint.json'
    def interrupt(stage, done, total):
        if stage == 'uploading' and done >= 5*MIB:
            raise KeyboardInterrupt
    with pytest.raises(KeyboardInterrupt):
        BulkTransfer(store).run(src, cp, SCOPE, Plan(size, 5*MIB, 1), interrupt)
    assert store.upload_calls == [1]
    receipt = BulkTransfer(store).run(src, cp, SCOPE, Plan(size, 5*MIB, 2))
    assert receipt.resumed_parts == 1
    assert store.upload_calls.count(1) == 1
    assert sorted(store.upload_calls) == [1, 2, 3]
    assert store.create_calls == 1 and store.complete_calls == 1


def test_source_same_size_and_mtime_but_changed_contents_cannot_resume(tmp_path):
    size = 6*MIB
    src = source_file(tmp_path, size)
    store = DiskStore(tmp_path / 'store')
    cp = tmp_path / 'checkpoint.json'
    def stop(stage, done, total):
        if stage == 'uploading' and done:
            raise KeyboardInterrupt
    with pytest.raises(KeyboardInterrupt):
        BulkTransfer(store).run(src, cp, SCOPE, Plan(size, 5*MIB, 1), stop)
    original = src.stat()
    with src.open('r+b') as f:
        f.seek(size-1)
        f.write(b'x')
    os.utime(src, ns=(original.st_atime_ns, original.st_mtime_ns))
    with pytest.raises(TransferError, match='Source, reserved scope'):
        BulkTransfer(store).run(src, cp, SCOPE, Plan(size, 5*MIB, 1))
    assert store.upload_calls == [1]


def test_part_source_mutation_during_upload_is_detected(tmp_path):
    size = 6*MIB
    src = source_file(tmp_path, size)
    store = DiskStore(tmp_path / 's3')
    def change(stage, done, total):
        if stage == 'uploading' and done == 5*MIB:
            with src.open('r+b') as f:
                f.seek(size-1)
                f.write(b'x')
    with pytest.raises(TransferError, match='Input changed'):
        BulkTransfer(store).run(src, tmp_path / 'cp', SCOPE, Plan(size, 5*MIB, 1), change)
    assert store.complete_calls == 0


def test_retries_only_transient_parts(tmp_path):
    src = source_file(tmp_path, 1024)
    store = DiskStore(tmp_path / 's3')
    store.fail_part_once = 1
    BulkTransfer(store, retry_delay=0).run(src, tmp_path / 'cp', SCOPE, Plan(1024))
    assert store.upload_calls == [1, 1]


def test_lost_completion_reply_reconciles_without_second_completion(tmp_path):
    src = source_file(tmp_path, 1024)
    store = DiskStore(tmp_path / 's3')
    store.completion_ack_lost = True
    cp = tmp_path / 'cp'
    with pytest.raises(CompletionUncertain):
        BulkTransfer(store).run(src, cp, SCOPE, Plan(1024))
    assert json.loads(cp.read_text())['stage'] == 'completing'
    receipt = BulkTransfer(store).run(src, cp, SCOPE, Plan(1024))
    assert receipt.size == 1024 and store.complete_calls == 1


def test_unresolved_completion_is_not_replayed(tmp_path):
    src = source_file(tmp_path, 1024)
    store = DiskStore(tmp_path / 's3')
    store.complete_without_writing = True
    cp = tmp_path / 'cp'
    with pytest.raises(CompletionUncertain):
        BulkTransfer(store).run(src, cp, SCOPE, Plan(1024))
    with pytest.raises(CompletionUncertain, match='manual reconciliation'):
        BulkTransfer(store).run(src, cp, SCOPE, Plan(1024))
    assert store.complete_calls == 1


def test_full_object_corruption_blocks_verified_state_and_closes_stream(tmp_path):
    src = source_file(tmp_path, 1024)
    store = DiskStore(tmp_path / 's3')
    store.corrupt_on_complete = True
    cp = tmp_path / 'cp'
    with pytest.raises(TransferError, match='SHA-256'):
        BulkTransfer(store).run(src, cp, SCOPE, Plan(1024))
    assert store.last_stream.closed
    assert json.loads(cp.read_text())['stage'] != 'verified'


def test_checkpoint_binds_all_scope_fields_and_bucket(tmp_path):
    src = source_file(tmp_path, 1024)
    store = DiskStore(tmp_path / 's3')
    cp = tmp_path / 'cp'
    BulkTransfer(store).run(src, cp, SCOPE, Plan(1024))
    for field in asdict(SCOPE):
        with pytest.raises(TransferError, match='reserved scope'):
            BulkTransfer(store).run(src, cp, replace(SCOPE, **{field: str(uuid4())}), Plan(1024))
    store.binding = 'another-storage-target'
    with pytest.raises(TransferError, match='storage changed'):
        BulkTransfer(store).run(src, cp, SCOPE, Plan(1024))


def test_never_overwrites_existing_object(tmp_path):
    src = source_file(tmp_path, 1024)
    store = DiskStore(tmp_path / 's3')
    BulkTransfer(store).run(src, tmp_path / 'cp', SCOPE, Plan(1024))
    with pytest.raises(TransferError, match='refusing overwrite'):
        BulkTransfer(store).run(src, tmp_path / 'new-cp', SCOPE, Plan(1024))


def test_abort_preserves_source_and_never_deletes_completed_objects(tmp_path):
    src = source_file(tmp_path, 1024)
    store = DiskStore(tmp_path / 's3')
    cp = tmp_path / 'cp'
    def stop(stage, done, total):
        if stage == 'uploading':
            raise KeyboardInterrupt
    with pytest.raises(KeyboardInterrupt):
        BulkTransfer(store).run(src, cp, SCOPE, Plan(1024), stop)
    BulkTransfer(store).abort(cp, SCOPE)
    assert src.stat().st_size == 1024
    assert json.loads(cp.read_text())['stage'] == 'aborted'
    with pytest.raises(TransferError):
        BulkTransfer(store).run(src, cp, SCOPE, Plan(1024))


@pytest.mark.parametrize('raw,size', [(b'ab', 3), (b'abcd', 3)])
def test_truncated_or_oversized_streams_are_not_success(raw, size):
    with pytest.raises(TransferError):
        verify_stream(io.BytesIO(raw), size, hashlib.sha256(b'abc').hexdigest())


def test_short_reads_are_supported_with_bounded_requests():
    class Short(io.BytesIO):
        def read(self, size=-1):
            assert 0 <= size <= MIB
            return super().read(min(size, 2))
    verify_stream(Short(b'abcd'), 4, hashlib.sha256(b'abcd').hexdigest())


def test_checkpoint_cannot_overwrite_source(tmp_path):
    src = source_file(tmp_path, 1024)
    with pytest.raises(TransferError):
        BulkTransfer(DiskStore(tmp_path / 's3')).run(src, src, SCOPE, Plan(1024))
    assert src.stat().st_size == 1024


def test_checkpoint_excludes_concurrent_processes(tmp_path):
    from app.bulk_transfer import _checkpoint_lease
    cp = tmp_path / 'cp'
    with _checkpoint_lease(cp):
        with pytest.raises(TransferError, match='already in use'):
            with _checkpoint_lease(cp):
                raise AssertionError('must not acquire another local lease')


def test_invalid_part_plan_cannot_be_restored(tmp_path):
    src = source_file(tmp_path, 1024)
    store = DiskStore(tmp_path / 's3')
    cp = tmp_path / 'cp'
    BulkTransfer(store).run(src, cp, SCOPE, Plan(1024))
    state = json.loads(cp.read_text())
    state['parts'] = {}
    cp.write_text(json.dumps(state))
    with pytest.raises(TransferError, match='without all parts'):
        BulkTransfer(store).run(src, cp, SCOPE, Plan(1024))
