"""Independent final-review regressions for the managed upload path."""
import gzip
import hashlib
import pytest
from app.large_data.policy import LargeDataError
from app.large_data.routes import LargeDataBodyLimit
from app.large_data.verify import verify_stream
from test_large_data_v44 import Body, row, FASTQ


@pytest.mark.parametrize("header", [b"@   ", b"@x\x00hidden", b"@x\x7fhidden"])
def test_fastq_identifier_control_bytes_rejected(header):
    data = header + b"\nACGT\n+\nIIII\n"
    with pytest.raises(LargeDataError, match="format_invalid"):
        verify_stream(Body(data), row(data), 1024**3)


def test_invalid_deflate_is_a_format_error_not_a_network_failure():
    # Minimal gzip header followed by an invalid DEFLATE block (reserved BTYPE=3).
    data = bytes.fromhex("1f8b0800000000000003") + b"\x07" + b"\x00" * 8
    with pytest.raises(LargeDataError, match="format_invalid"):
        verify_stream(Body(data), row(data, 'fastq.gz'), 1024**3)


@pytest.mark.parametrize("declared, blocks, expected", [
    (2, [b"x" * 20000], 413),
    (2, [b"{", b"}" + b"x" * 20], 400),
    (4, [b"{}"], 400),
    (2, [b"{", b"}"], 204),
    (0, [b""], 204),
    (16384, [b"x" * 4096] * 4, 204),
])
def test_asgi_body_size_is_enforced_on_received_bytes(declared, blocks, expected):
    import asyncio
    seen = []
    sent = []
    async def downstream(scope, receive, send):
        seen.append((await receive())["body"])
        await send({"type": "http.response.start", "status": 204, "headers": []})
        await send({"type": "http.response.body", "body": b""})
    messages = iter({"type": "http.request", "body": b, "more_body": i < len(blocks)-1}
                    for i, b in enumerate(blocks))
    async def receive():
        return next(messages, {"type": "http.disconnect"})
    async def send(message):
        sent.append(message)
    asyncio.run(LargeDataBodyLimit(downstream)({
        "type": "http", "method": "POST", "path": "/api/v1/large-data/uploads",
        "headers": [(b"content-length", str(declared).encode())],
    }, receive, send))
    assert sent[0]["status"] == expected
    assert bool(seen) == (expected == 204)
    if seen:
        assert seen[0] == b"".join(blocks)
    else:
        assert (b"cache-control", b"no-store") in sent[0]["headers"]


def test_duplicate_content_length_never_reaches_app():
    import asyncio
    sent = []
    async def downstream(*_):
        pytest.fail("ambiguous metadata length reached application")
    async def receive():
        return {"type": "http.request", "body": b"{}"}
    async def send(message):
        sent.append(message)
    asyncio.run(LargeDataBodyLimit(downstream)({
        "type": "http", "method": "POST", "path": "/api/v1/large-data/uploads",
        "headers": [(b"content-length", b"2"), (b"content-length", b"20000")],
    }, receive, send))
    assert sent[0]["status"] == 411


def test_300_varied_fastq_fixtures_match_independent_aggregate_reference():
    import random
    rng = random.Random(441018)
    for case in range(300):
        records = []
        sequences = []
        scores = []
        for i in range(rng.randint(1, 25)):
            sequence = ''.join(rng.choices('ACGTN', k=rng.randint(1, 200)))
            q = [rng.choice([0, 1, 19, 20, 29, 30, 40, 60, 93]) for _ in sequence]
            sequences.append(sequence)
            scores.extend(q)
            records.append(f'@read_{i}\n{sequence.lower() if i % 2 else sequence}\n+\n' + ''.join(chr(x+33) for x in q) + '\n')
        source = ''.join(records).encode()
        compressed = case % 2 == 0
        data = gzip.compress(source, mtime=0) if compressed else source
        digest, result = verify_stream(Body(data), row(data, 'fastq.gz' if compressed else 'fastq'), 1024**3)
        m = result['metrics']; combined = ''.join(sequences)
        expected = {b: combined.count(b) for b in 'ACGTN'}
        assert digest == hashlib.sha256(data).hexdigest()
        assert m['read_count'] == len(sequences) and m['base_count'] == len(combined)
        assert m['base_counts'] == expected
        assert m['q20_bases'] == len([q for q in scores if q >= 20])
        assert m['q30_bases'] == len([q for q in scores if q >= 30])
        assert m['mean_phred'] == pytest.approx(sum(scores) / len(scores))
        assert m['min_length'] == min(map(len, sequences))
        assert m['max_length'] == max(map(len, sequences))
        assert m['expanded_bytes'] == len(source) and m['sampling'] is False
        denominator = sum(expected[b] for b in 'ACGT')
        if denominator:
            assert m['gc_percent'] == pytest.approx(100*(expected['C']+expected['G'])/denominator)
        else:
            assert m['gc_percent'] is None


def test_all_concatenated_gzip_members_are_scanned():
    data = gzip.compress(FASTQ, mtime=0) + gzip.compress(FASTQ, mtime=0)
    _, result = verify_stream(Body(data), row(data, 'fastq.gz'), 1024**3)
    assert result['metrics']['read_count'] == 4
    assert result['metrics']['base_count'] == 18
    assert result['metrics']['expanded_bytes'] == 2*len(FASTQ)
