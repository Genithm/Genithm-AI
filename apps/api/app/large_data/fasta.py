"""Complete bounded FASTA structural statistics, including unwrapped sequences.

No DNA/RNA/protein inference, retained sequences, headers, uniqueness claim,
clinical interpretation or arbitrary scientific algorithm is involved.
"""
from __future__ import annotations

from .policy import CHUNK_BYTES, LargeDataError

SYMBOLS = "ABCDEFGHIJKLMNOPQRSTUVWXYZ*-."
INVALID = bytes(0 if chr(n) in SYMBOLS else 1 for n in range(256))


def scan_fasta(stream, max_expanded_bytes: int, tick=lambda: None) -> dict:
    counts = {symbol: 0 for symbol in SYMBOLS}
    records = total = length = expanded = 0
    minimum = maximum = None
    header = bytearray()
    header_mode = False
    line_start = True
    have_record = False

    def finish_header():
        text = bytes(header).rstrip(b"\r")
        try:
            decoded = text.decode("utf-8")
        except UnicodeDecodeError:
            raise LargeDataError("format_invalid") from None
        if not decoded.strip() or any(ord(c) < 32 and c != "\t" for c in decoded) or "\x7f" in decoded:
            raise LargeDataError("format_invalid")
        header.clear()

    def finish_record():
        nonlocal records, total, minimum, maximum, length
        if not length:
            raise LargeDataError("format_invalid")
        records += 1
        total += length
        minimum = length if minimum is None else min(minimum, length)
        maximum = length if maximum is None else max(maximum, length)
        length = 0

    while True:
        tick()
        block = stream.read(CHUNK_BYTES)
        if not block:
            break
        expanded += len(block)
        if expanded > max_expanded_bytes:
            raise LargeDataError("resource_limit")
        # Only LF is a record-line delimiter. All fragments are bounded by CHUNK_BYTES.
        fragments = block.split(b"\n")
        for index, fragment in enumerate(fragments):
            terminated = index < len(fragments) - 1
            if not fragment and not terminated:
                continue
            if line_start and fragment.startswith(b">"):
                if have_record:
                    finish_record()
                have_record, header_mode = True, True
                fragment = fragment[1:]
            if header_mode:
                if len(header) + len(fragment) > 4096:
                    raise LargeDataError("resource_limit")
                header.extend(fragment)
                if terminated:
                    finish_header()
                    header_mode = False
            else:
                symbols = fragment.translate(None, b" \t\r").upper()
                if symbols:
                    if not have_record or symbols.translate(INVALID).count(b"\x01"):
                        raise LargeDataError("format_invalid")
                    length += len(symbols)
                    for symbol in SYMBOLS:
                        counts[symbol] += symbols.count(ord(symbol))
            line_start = terminated
    if header_mode:
        finish_header()
    if not have_record:
        raise LargeDataError("format_invalid")
    finish_record()
    return {"schema": "genithm-fasta-summary/1", "record_count": records, "symbol_count": total,
        "minimum_length": minimum, "maximum_length": maximum, "mean_length": total / records,
        "symbol_counts": counts, "expanded_bytes": expanded, "sampling": False,
        "alphabet_interpretation": "unassigned", "duplicate_identifiers_checked": False}
