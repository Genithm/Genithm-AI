"""Actual bounded-memory transfer benchmark; never targets production storage.

Loopback S3 mode uploads every byte, intentionally interrupts once, resumes,
then GETs and hashes the complete object. Disk mode is for local diagnostics.
All payloads are synthetic binary bytes, NOT biological validation datasets.
"""
from __future__ import annotations

import argparse
import hashlib
import json
import platform
import resource
import tempfile
import threading
import time
from dataclasses import asdict
from pathlib import Path
from uuid import uuid4

from app.bulk_transfer import BulkTransfer, Plan, Scope, MIB, GIB


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument('--gib', type=int, choices=[1, 2], default=2)
    parser.add_argument('--s3-loopback', action='store_true')
    args = parser.parse_args()
    size = args.gib * GIB
    scope = Scope(*[str(uuid4()) for _ in range(4)])
    started = time.perf_counter()
    client = None
    bucket = 'genithm-ci-' + uuid4().hex
    with tempfile.TemporaryDirectory(prefix='genithm-bulk-ci-') as work:
        root = Path(work)
        source = root / 'synthetic.bin'
        block = bytes(range(256)) * 4096  # exactly 1 MiB, real writes, not sparse
        expected = hashlib.sha256()
        with source.open('wb') as handle:
            for _ in range(size // len(block)):
                handle.write(block)
                expected.update(block)
        generated_seconds = time.perf_counter() - started
        if args.s3_loopback:
            import boto3
            from botocore.config import Config
            from app.bulk_s3 import S3MultipartStore
            # No environment credentials or caller-selected endpoint are read.
            client = boto3.client('s3', endpoint_url='http://127.0.0.1:9000',
                aws_access_key_id='test-genithm',
                aws_secret_access_key='temporary-ci-only-password-0123456789',
                region_name='us-east-1', config=Config(signature_version='s3v4',
                    retries={'total_max_attempts': 1},
                    s3={'addressing_style': 'path'},
                    request_checksum_calculation='when_required',
                    response_checksum_validation='when_required'))
            client.create_bucket(Bucket=bucket)
            base = S3MultipartStore(client, bucket, allow_loopback_http=True)
        else:
            from test_bulk_transfer import DiskStore
            base = DiskStore(root / 'store')
        lock = threading.Lock()
        counters = {'uploaded_bytes': 0, 'upload_part_calls': 0}
        class Observed:
            def __getattr__(self, name):
                return getattr(base, name)
            def upload(self, key, upload_id, number, data):
                reply = base.upload(key, upload_id, number, data)
                with lock:
                    counters['uploaded_bytes'] += len(data)
                    counters['upload_part_calls'] += 1
                return reply
        store = Observed()
        checkpoint = root / 'checkpoint.json'
        interrupted = False
        plan = Plan(size, 16*MIB, 1)
        transfer_start = time.perf_counter()
        def stop_after_two(stage, done, total):
            if stage == 'uploading' and done == 32*MIB:
                raise KeyboardInterrupt('injected interruption; private checkpoint retained')
        try:
            try:
                BulkTransfer(store).run(source, checkpoint, scope, plan, stop_after_two)
            except KeyboardInterrupt:
                interrupted = True
            assert interrupted and checkpoint.exists()
            resume_start = time.perf_counter()
            receipt = BulkTransfer(store).run(source, checkpoint, scope, Plan(size, 16*MIB, 2))
            elapsed = time.perf_counter() - transfer_start
            assert receipt.sha256 == expected.hexdigest()
            assert receipt.size == size and receipt.resumed_parts == 2
            assert counters['uploaded_bytes'] == size, 'A checkpointed part was retransmitted'
            rss_kib = resource.getrusage(resource.RUSAGE_SELF).ru_maxrss
            assert rss_kib < 512*1024, 'Client peak RSS exceeded 512 MiB on this runner'
            output = {
                'schema': 'genithm-large-transfer-benchmark/1',
                'backend': 'actual_loopback_s3' if args.s3_loopback else 'filesystem_transport_fixture',
                'synthetic_bytes': size, 'part_size_bytes': plan.part_size,
                'resume_concurrency': 2, 'receipt': asdict(receipt),
                'source_sha256_independently_computed_during_generation': expected.hexdigest(),
                'interruption_injected': interrupted,
                'checkpoint_size_bytes': checkpoint.stat().st_size,
                **counters, 'generation_seconds': round(generated_seconds, 4),
                'transfer_including_initial_and_resume_fingerprints_and_full_get_verification_seconds': round(elapsed, 4),
                'resume_run_seconds': round(time.perf_counter() - resume_start, 4),
                'client_peak_rss_kib': rss_kib, 'python': platform.python_version(),
                'platform': platform.platform(),
                'limits': 'Measures data transport only. Loopback, not WAN/R2 production; RSS excludes object-storage server. No scientific computation or application UI test.',
            }
            print(json.dumps(output, indent=2))
        finally:
            if client is not None:
                try:
                    active = client.list_multipart_uploads(Bucket=bucket).get('Uploads', [])
                    for item in active:
                        client.abort_multipart_upload(Bucket=bucket, Key=item['Key'], UploadId=item['UploadId'])
                    client.delete_object(Bucket=bucket, Key=scope.key)
                    client.delete_bucket(Bucket=bucket)
                finally:
                    client.close()
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
