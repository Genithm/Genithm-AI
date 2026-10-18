"""Bounded, resumable transport for trusted background data-ingestion processes.

Not an HTTP endpoint or an authorization decision. Callers MUST authorize and
reserve the project/dataset before constructing Scope, hold an exclusive lease,
and keep the checkpoint on private durable storage. A transport receipt is NOT
format validation, pipeline completion, or evidence of biological correctness.
"""
from __future__ import annotations

import hashlib
import fcntl
import json
import math
import os
import stat
import tempfile
import time
from concurrent.futures import FIRST_COMPLETED, ThreadPoolExecutor, wait
from contextlib import contextmanager
from dataclasses import asdict, dataclass
from pathlib import Path
from typing import BinaryIO, Callable, ContextManager, Protocol
from uuid import UUID

MIB = 1024 * 1024
GIB = 1024 * MIB
READ_BYTES = MIB
MAX_OBJECT_BYTES = 100 * GIB
MAX_PARTS = 10_000
CHECKPOINT_LIMIT = 4 * MIB


class TransferError(RuntimeError):
    """Stable public errors never include credentials, URLs, or input contents."""


class RetryableTransferError(TransferError):
    pass


class CompletionUncertain(TransferError):
    pass


@dataclass(frozen=True)
class Plan:
    size: int
    part_size: int = 16 * MIB
    concurrency: int = 2

    def __post_init__(self) -> None:
        if type(self.size) is not int or not 1 <= self.size <= MAX_OBJECT_BYTES:
            raise TransferError("Object size must be between 1 byte and 100 GiB")
        if type(self.part_size) is not int or not 5 * MIB <= self.part_size <= 64 * MIB:
            raise TransferError("Part size must be between 5 and 64 MiB")
        if type(self.concurrency) is not int or not 1 <= self.concurrency <= 4:
            raise TransferError("Concurrency must be between one and four")
        if self.parts > MAX_PARTS:
            raise TransferError("Too many parts; choose a larger part size")

    @property
    def parts(self) -> int:
        return math.ceil(self.size / self.part_size)

    def length(self, number: int) -> int:
        if type(number) is not int or not 1 <= number <= self.parts:
            raise TransferError("Invalid part number")
        return min(self.part_size, self.size - (number - 1) * self.part_size)


@dataclass(frozen=True)
class Scope:
    organization: str
    project: str
    owner: str
    dataset: str

    def __post_init__(self) -> None:
        for name, value in asdict(self).items():
            try:
                normalized = str(UUID(value))
            except (ValueError, TypeError, AttributeError) as exc:
                raise TransferError("Invalid reserved scope identifier") from exc
            object.__setattr__(self, name, normalized)

    @property
    def key(self) -> str:
        return "datasets/" + "/".join(asdict(self).values())


@dataclass(frozen=True)
class Part:
    number: int
    size: int
    etag: str


@dataclass(frozen=True)
class ObjectInfo:
    size: int
    etag: str
    metadata: dict[str, str]


@dataclass(frozen=True)
class Receipt:
    size: int
    sha256: str
    parts: int
    resumed_parts: int
    etag: str
    verification: str = "full_object_streamed_sha256"


class Store(Protocol):
    binding: str

    def head(self, key: str) -> ObjectInfo | None: ...
    def create(self, key: str, metadata: dict[str, str]) -> str: ...
    def list_parts(self, key: str, upload_id: str) -> list[Part]: ...
    def upload(self, key: str, upload_id: str, number: int, data: bytes) -> str: ...
    def complete(self, key: str, upload_id: str, parts: list[Part]) -> None: ...
    def abort(self, key: str, upload_id: str) -> None: ...
    def open(self, key: str, etag: str) -> ContextManager[BinaryIO]: ...


# stage, actual bytes processed in this stage, total bytes -- not predicted ETA.
Progress = Callable[[str, int, int], None]


def _emit(callback: Progress | None, stage: str, current: int, total: int) -> None:
    if callback:
        callback(stage, current, total)


def _regular(path: Path) -> BinaryIO:
    fd = os.open(path, os.O_RDONLY | getattr(os, "O_NOFOLLOW", 0))
    if not stat.S_ISREG(os.fstat(fd).st_mode):
        os.close(fd)
        raise TransferError("Source must be a regular local file")
    return os.fdopen(fd, "rb")


def fingerprint(path: Path, plan: Plan, callback: Progress | None = None) -> dict:
    """Hash the entire source and each part without materializing the file."""
    full = hashlib.sha256()
    leaves: list[str] = []
    total = 0
    with _regular(path) as stream:
        if os.fstat(stream.fileno()).st_size != plan.size:
            raise TransferError("Source size disagrees with reserved size")
        for number in range(1, plan.parts + 1):
            leaf = hashlib.sha256()
            left = plan.length(number)
            while left:
                data = stream.read(min(READ_BYTES, left))
                if not data:
                    raise TransferError("Source was truncated during fingerprinting")
                full.update(data)
                leaf.update(data)
                total += len(data)
                left -= len(data)
                _emit(callback, "fingerprinting", total, plan.size)
            leaves.append(leaf.hexdigest())
        if stream.read(1):
            raise TransferError("Source grew during fingerprinting")
    return {"size": plan.size, "sha256": full.hexdigest(), "part_sha256": leaves}


def verify_stream(stream: BinaryIO, size: int, expected: str, callback: Progress | None = None) -> None:
    """Read every stored byte. Multipart ETags are NOT whole-file SHA-256."""
    digest = hashlib.sha256()
    read = 0
    while read < size:
        requested = min(READ_BYTES, size - read)
        block = stream.read(requested)
        if not isinstance(block, bytes) or not block or len(block) > requested:
            raise TransferError("Stored object was truncated or returned invalid data")
        digest.update(block)
        read += len(block)
        _emit(callback, "verifying", read, size)
    if stream.read(1):
        raise TransferError("Stored object is larger than reserved")
    if digest.hexdigest() != expected:
        raise TransferError("Stored object SHA-256 does not match the complete source")


def _save(path: Path, value: dict) -> None:
    """Atomic private checkpoint replacement; no credentials or sequence data."""
    encoded = json.dumps(value, sort_keys=True, separators=(",", ":")).encode()
    if len(encoded) > CHECKPOINT_LIMIT:
        raise TransferError("Checkpoint exceeded metadata limit")
    fd, temporary = tempfile.mkstemp(prefix=".genithm-transfer-", dir=path.parent)
    try:
        os.fchmod(fd, 0o600)
        with os.fdopen(fd, "wb") as handle:
            handle.write(encoded)
            handle.flush()
            os.fsync(handle.fileno())
        os.replace(temporary, path)
        dir_fd = os.open(path.parent, os.O_RDONLY | getattr(os, "O_DIRECTORY", 0))
        try:
            os.fsync(dir_fd)
        finally:
            os.close(dir_fd)
    finally:
        if os.path.exists(temporary):
            os.unlink(temporary)


def _load(path: Path) -> dict:
    try:
        with _regular(path) as handle:
            data = handle.read(CHECKPOINT_LIMIT + 1)
        if len(data) > CHECKPOINT_LIMIT:
            raise TransferError("Checkpoint exceeded metadata limit")
        value = json.loads(data)
        if not isinstance(value, dict):
            raise ValueError
        return value
    except (ValueError, OSError) as exc:
        raise TransferError("Checkpoint is malformed or unavailable") from exc


@contextmanager
def _checkpoint_lease(path: Path):
    # Local-process exclusion complements, but cannot replace, the caller's
    # distributed reservation/lease. Never unlink a lock inode while in use.
    lock_path = path.with_name(path.name + ".lock")
    fd = os.open(lock_path, os.O_WRONLY | os.O_CREAT | getattr(os, "O_NOFOLLOW", 0), 0o600)
    try:
        try:
            fcntl.flock(fd, fcntl.LOCK_EX | fcntl.LOCK_NB)
        except BlockingIOError as exc:
            raise TransferError("Transfer checkpoint is already in use") from exc
        yield
    finally:
        os.close(fd)


class BulkTransfer:
    """One leased transfer per instance, with bounded in-flight parts.

    Owner authorization, durable lease/fencing and quota reservation belong to
    the caller, not a user-supplied Scope/checkpoint. Never expose directly as an
    HTTP endpoint. Only retry idempotent part uploads, not uncertain completion.
    """

    def __init__(self, store: Store, *, retry_delay: float = 0.25):
        self.store = store
        self.retry_delay = retry_delay

    def run(self, source: Path, checkpoint: Path, scope: Scope, plan: Plan,
            callback: Progress | None = None) -> Receipt:
        with _checkpoint_lease(Path(checkpoint)):
            return self._run(source, checkpoint, scope, plan, callback)

    def _run(self, source: Path, checkpoint: Path, scope: Scope, plan: Plan,
             callback: Progress | None = None) -> Receipt:
        source, checkpoint = Path(source), Path(checkpoint)
        if source.resolve() == checkpoint.resolve():
            raise TransferError("Checkpoint cannot replace the input file")
        if checkpoint.is_symlink():
            raise TransferError("Checkpoint must not be a symlink")
        identity = fingerprint(source, plan, callback)
        expected = {"schema": "genithm-multipart/1", "scope": asdict(scope),
                    "storage_binding": self.store.binding, "part_size": plan.part_size,
                    "source": identity}
        if checkpoint.exists():
            state = _load(checkpoint)
            if any(state.get(k) != v for k, v in expected.items()):
                raise TransferError("Source, reserved scope or storage changed; cannot resume")
            self._validate(state, plan)
        else:
            if self.store.head(scope.key) is not None:
                raise TransferError("Reserved object already exists; refusing overwrite")
            upload_id = self.store.create(scope.key, {
                "genithm-dataset": scope.dataset, "genithm-sha256": identity["sha256"]})
            state = {**expected, "upload_id": upload_id, "stage": "uploading", "parts": {}}
            try:
                self._validate(state, plan)
                _save(checkpoint, state)
            except BaseException:
                # No checkpoint was committed; avoid a known orphan where possible.
                self.store.abort(scope.key, upload_id)
                raise
        if state["stage"] == "aborted":
            raise TransferError("Transfer has been aborted")
        resumed = len(state["parts"])
        if state["stage"] == "uploading":
            remote = self.store.list_parts(scope.key, state["upload_id"])
            by_number: dict[int, Part] = {}
            for part in remote:
                if part.number in by_number or not 1 <= part.number <= plan.parts:
                    raise TransferError("Remote multipart listing is inconsistent")
                by_number[part.number] = part
            # A part is reused only when durable acknowledgement agrees with
            # authoritative storage metadata. Unacknowledged writes are redone.
            keep = {k: v for k, v in state["parts"].items()
                    if by_number.get(int(k)) == Part(int(k), v["size"], v["etag"])}
            state["parts"] = keep
            resumed = len(keep)
            _save(checkpoint, state)
            pending = (i for i in range(1, plan.parts + 1) if str(i) not in keep)
            transferred = sum(v["size"] for v in keep.values())
            _emit(callback, "uploading", transferred, plan.size)
            with ThreadPoolExecutor(max_workers=plan.concurrency) as pool:
                active = {}
                def submit() -> bool:
                    try:
                        number = next(pending)
                    except StopIteration:
                        return False
                    future = pool.submit(self._part, source, scope, plan, state["upload_id"],
                                         number, identity["part_sha256"][number - 1])
                    active[future] = number
                    return True
                for _ in range(plan.concurrency):
                    submit()
                try:
                    while active:
                        done, _ = wait(active, return_when=FIRST_COMPLETED)
                        for future in done:
                            number = active.pop(future)
                            etag = future.result()
                            state["parts"][str(number)] = {"size": plan.length(number), "etag": etag}
                            _save(checkpoint, state)
                            transferred += plan.length(number)
                            _emit(callback, "uploading", transferred, plan.size)
                            submit()
                except BaseException:
                    for future in active:
                        future.cancel()
                    raise
            state["stage"] = "completing"
            _save(checkpoint, state)
            parts = [Part(i, plan.length(i), state["parts"][str(i)]["etag"])
                     for i in range(1, plan.parts + 1)]
            try:
                self.store.complete(scope.key, state["upload_id"], parts)
            except Exception as exc:
                raise CompletionUncertain("Completion acknowledgement lost; reconcile before any retry") from exc
            state["stage"] = "uploaded"
            _save(checkpoint, state)
        # Recover completion acknowledgement loss only by observing and hashing
        # the already stored object. Never blindly issue another completion.
        info = self.store.head(scope.key)
        if info is None:
            raise CompletionUncertain("Completed object not visible; manual reconciliation required")
        if (info.size != plan.size or not info.etag or
                info.metadata.get("genithm-dataset") != scope.dataset or
                info.metadata.get("genithm-sha256") != identity["sha256"]):
            raise TransferError("Stored object does not match the reserved dataset")
        with self.store.open(scope.key, info.etag) as stream:
            verify_stream(stream, plan.size, identity["sha256"], callback)
        state["stage"] = "verified"
        state["object_etag"] = info.etag
        _save(checkpoint, state)
        return Receipt(plan.size, identity["sha256"], plan.parts, resumed, info.etag)

    def _part(self, source: Path, scope: Scope, plan: Plan, upload_id: str,
              number: int, expected_sha: str) -> str:
        with _regular(source) as stream:
            stream.seek((number - 1) * plan.part_size)
            data = stream.read(plan.length(number))
        if len(data) != plan.length(number) or hashlib.sha256(data).hexdigest() != expected_sha:
            raise TransferError("Input changed while uploading; part withheld")
        for attempt in range(3):
            try:
                etag = self.store.upload(scope.key, upload_id, number, data)
                if not isinstance(etag, str) or not 1 <= len(etag) <= 256:
                    raise TransferError("Invalid storage part acknowledgement")
                return etag
            except RetryableTransferError:
                if attempt == 2:
                    raise
                time.sleep(self.retry_delay * (2 ** attempt))
        raise AssertionError("unreachable")

    @staticmethod
    def _validate(state: dict, plan: Plan) -> None:
        if (state.get("stage") not in {"uploading", "completing", "uploaded", "verified", "aborted"}
                or not isinstance(state.get("upload_id"), str)
                or not 1 <= len(state["upload_id"]) <= 2048
                or not isinstance(state.get("parts"), dict)):
            raise TransferError("Invalid transfer checkpoint")
        for number, value in state["parts"].items():
            if (not isinstance(number, str) or not number.isascii() or not number.isdigit()
                    or str(int(number)) != number or not 1 <= int(number) <= plan.parts
                    or not isinstance(value, dict) or type(value.get("size")) is not int
                    or value.get("size") != plan.length(int(number))
                    or not isinstance(value.get("etag"), str) or not 1 <= len(value["etag"]) <= 256):
                raise TransferError("Invalid checkpoint part entry")
        if state["stage"] in {"completing", "uploaded", "verified"} and len(state["parts"]) != plan.parts:
            raise TransferError("Checkpoint claims completion without all parts")

    def abort(self, checkpoint: Path, scope: Scope) -> None:
        with _checkpoint_lease(Path(checkpoint)):
            self._abort(checkpoint, scope)

    def _abort(self, checkpoint: Path, scope: Scope) -> None:
        state = _load(checkpoint)
        if state.get("scope") != asdict(scope) or state.get("storage_binding") != self.store.binding:
            raise TransferError("Cannot abort another reserved dataset")
        if state.get("stage") != "uploading":
            raise TransferError("Abort requires an active upload; stored objects are never deleted")
        self.store.abort(scope.key, state["upload_id"])
        state["stage"] = "aborted"
        _save(checkpoint, state)
