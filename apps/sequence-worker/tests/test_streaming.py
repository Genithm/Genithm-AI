from __future__ import annotations

import io
import random
from hashlib import sha256

import pytest

from genithm_sequence_worker import streaming
from genithm_sequence_worker.statistics import calculate_sequence_statistics
from genithm_sequence_worker.validator import FastaValidationError, validate_fasta_bytes


def assert_parity(data: bytes, size: int) -> None:
    chunks = (data[i:i + size] for i in range(0, len(data), size))
    try:
        expected = validate_fasta_bytes(data)
    except FastaValidationError:
        with pytest.raises(streaming.FastaStreamValidationError) as rejected:
            streaming.analyze_fasta_chunks(chunks, expected_size=len(data) or None)
        assert rejected.value.sha256 == sha256(data).hexdigest()
    else:
        result, stats = streaming.analyze_fasta_chunks(chunks, expected_size=len(data))
        assert result == expected
        assert stats == calculate_sequence_statistics(data)


@pytest.mark.parametrize("size", [1, 2, 3, 7, 64, 65536])
def test_utf8_bom_lines_whitespace_headers_and_classification(size):
    cases = [
        b">a\nACGT\n>b\nNN--RY..\n", b">a\nACGU\n", b">a\nTU\n",
        b">p\nMNPKL*-\n", b">a\nAC\n>a\nGU\n",
        "\ufeff >header\r\n ac \tgt--\r\n >header \r\n mnpKL \n".encode(),
        ">\u00e9\n ac\u00a0gt\tNN \n >\u00e9\nUG\n".encode(),
        ">p\n\u00df\u0131J\n".encode(),  # Existing uppercase policy expansion.
        b">a\n- .\nACGT\n", b">a\n  AC\t GT   ",
        b">a\nACGT", b">a\nACGT\n\n", b">a\nACGT\r\n\r\n",
        b"", b"ACGT", b">a\n", b">a\n-.-\n", b">\nACGT",
        b">a\nACGT\n>b\n", b">a\nAC!T\n", b">a\nAC\xff\n",
        b">a\nAC\xc3", b">a\nAC\x00GT\n", b">a\nAC!\xff\0\n",
        b">" + b"a" * 1001 + b"\nACGT", b">a\nACGT\n#comment",
    ]
    for data in cases:
        assert_parity(data, size)
    for boundary in ["\n", "\r", "\r\n", "\v", "\f", "\x1c", "\x1d", "\x1e", "\x85", "\u2028", "\u2029"]:
        assert_parity((">a" + boundary + "ACGT" + boundary + ">b" + boundary + "NN").encode(), size)


def test_seeded_random_dna_rna_protein_and_chunk_boundaries():
    rng = random.Random(42)
    alphabets = ["ACGTRYSWKMBDHVN", "ACGURYSWKMBDHVN", "ACDEFGHIKLMNPQRSTVWYBXZJUO*", "ACGTUN-"]
    for case in range(700):
        alphabet = rng.choice(alphabets)
        ends = rng.choice(["\n", "\r\n", "\u2028", "\r"])
        records = []
        for i in range(rng.randint(1, 10)):
            name = "duplicate" if i % 2 else "record-" + str(i)
            lines = []
            for _ in range(rng.randint(1, 5)):
                bases = "".join(rng.choices(alphabet, k=rng.randint(1, 100)))
                if case % 3 == 0:
                    bases = "  " + "\t".join(bases) + " "
                lines.append(bases.lower())
            records.append(">" + name + ends + ends.join(lines))
        data = (ends.join(records) + ends).encode()
        assert_parity(data, rng.choice([1, 3, 7, 127, 65536]))


def test_explicit_counts_without_reference_implementation():
    data = b">one\nACGTNN-..\n>two\nGC\n"
    result, stats = streaming.analyze_fasta_chunks([data])
    assert result.sequence_count == 2
    assert result.residue_count == 8
    assert result.sha256 == sha256(data).hexdigest()
    assert stats.min_record_length == 2
    assert stats.max_record_length == 6
    assert stats.mean_record_length == 4
    assert stats.gap_count == 3
    assert stats.composition == {"A": 1, "C": 2, "G": 2, "N": 2, "T": 1}
    assert stats.gc_denominator_count == 6
    assert stats.gc_content_percent == 66.666667
    assert stats.frequencies["N"] == 0.25


def test_unwrapped_lines_and_long_trailing_whitespace_are_not_buffered():
    import tracemalloc
    chunk = b"ACGT" * 16384
    tracemalloc.start()
    result, stats = streaming.analyze_fasta_chunks(
        iter([b">a\n"] + [chunk] * 128 + [b"\n>b" + b" " * 65536, b"\nNN\n"])
    )
    _, peak = tracemalloc.get_traced_memory()
    tracemalloc.stop()
    assert result.residue_count == len(chunk) * 128 + 2
    assert stats.max_record_length == len(chunk) * 128
    assert peak < 3 * 1024 * 1024, peak


def test_header_limit_does_not_count_trailing_whitespace():
    assert_parity(b">" + b"x" * 1000 + b" " * 100_000 + b"\nA\n", 65536)
    assert_parity(b">x" + b" " * 100_000 + b"y\nA\n", 65536)


def test_rejection_drains_full_bounded_object_and_never_returns_prefix_hash():
    data = [b">a\nBAD1\n", b"ACGT\n", b"\xc3", b"\xa9\n"]
    visited = []
    def chunks():
        for chunk in data:
            visited.append(chunk)
            yield chunk
    with pytest.raises(streaming.FastaStreamValidationError) as rejected:
        streaming.analyze_fasta_chunks(chunks(), expected_size=sum(map(len, data)))
    assert visited == data
    assert rejected.value.sha256 == sha256(b"".join(data)).hexdigest()


@pytest.mark.parametrize("expected", [0, -1, True, 52_428_801])
def test_invalid_size_rejected_before_read(expected):
    class NeverRead:
        def read(self, _n):
            raise AssertionError("Untrusted size must be rejected before read")
    with pytest.raises(streaming.FastaTransferError):
        streaming.analyze_fasta_stream(NeverRead(), expected_size=expected)


def test_exact_size_and_disconnects_are_infrastructure_errors():
    for expected in [7, 9]:
        with pytest.raises(streaming.FastaTransferError):
            streaming.analyze_fasta_stream(io.BytesIO(b">a\nACGT\n"), expected_size=expected)
    def broken():
        yield b">a\nBAD1\n"
        raise OSError("Network disconnected")
    with pytest.raises(OSError):
        streaming.analyze_fasta_chunks(broken(), expected_size=100)


def test_reader_never_receives_whole_object_read():
    data = b">a\n" + b"ACGT" * 1_000_000 + b"\n"
    class Reader(io.BytesIO):
        def read(self, n=-1):
            assert 1 <= n <= streaming.CHUNK_BYTES
            return super().read(n)
    result, _ = streaming.analyze_fasta_stream(Reader(data), expected_size=len(data))
    assert result.residue_count == 4_000_000


def test_record_limit_is_unchanged(monkeypatch):
    monkeypatch.setattr(streaming, "MAX_RECORDS", 2)
    with pytest.raises(streaming.FastaStreamValidationError, match="record limit"):
        streaming.analyze_fasta_chunks([b">a\nACGT\n" * 3])
