from __future__ import annotations

import re
import subprocess
import tempfile
from dataclasses import dataclass
from pathlib import Path

TOOL_ID = "mafft"
TOOL_VERSION = "7.505-1"
EXECUTOR_VERSION = "genithm-scientific-worker/0.3.0"
MAX_SEQUENCES = 50
MAX_TOTAL_RESIDUES = 100_000
MAX_ALIGNMENT_BYTES = 25 * 1024 * 1024
_ID_RE = re.compile(r"^seq([1-9][0-9]*)$")


class MsaError(ValueError):
    pass


@dataclass(frozen=True, slots=True)
class MsaRecord:
    record_id: str
    sequence: str


def parse_single_fasta(data: bytes) -> str:
    if not data or len(data) > 2 * 1024 * 1024:
        raise MsaError("FASTA input is empty or exceeds worker read limit")
    try:
        text = data.decode("utf-8-sig")
    except UnicodeDecodeError as exc:
        raise MsaError("FASTA input must be UTF-8 text") from exc
    sequence: list[str] = []
    headers = 0
    for raw in text.splitlines():
        line = raw.strip()
        if not line:
            continue
        if line.startswith(">"):
            headers += 1
            if headers > 1:
                raise MsaError("MSA requires one FASTA record per input")
            continue
        if headers != 1:
            raise MsaError("sequence appears before FASTA header")
        sequence.extend(ch.upper() for ch in line if not ch.isspace())
    if headers != 1 or not sequence:
        raise MsaError("FASTA input must contain exactly one non-empty record")
    result = "".join(sequence)
    if "-" in result or "." in result:
        raise MsaError("MSA requires ungapped input sequences")
    return result


def build_mafft_input(sequences: list[str]) -> bytes:
    if len(sequences) < 3 or len(sequences) > MAX_SEQUENCES:
        raise MsaError("MSA requires between 3 and 50 sequences")
    if sum(len(seq) for seq in sequences) > MAX_TOTAL_RESIDUES:
        raise MsaError("MSA total residues exceed the approved compute budget")
    chunks: list[str] = []
    for index, sequence in enumerate(sequences, start=1):
        if not sequence:
            raise MsaError("MSA input sequence must not be empty")
        chunks.extend((f">seq{index}", sequence))
    return ("\n".join(chunks) + "\n").encode("ascii")


def parse_alignment(data: bytes, original_sequences: list[str]) -> list[MsaRecord]:
    if not data or len(data) > MAX_ALIGNMENT_BYTES:
        raise MsaError("MAFFT output is empty or exceeds approved result size")
    try:
        text = data.decode("ascii")
    except UnicodeDecodeError as exc:
        raise MsaError("MAFFT output must be ASCII FASTA") from exc

    records: list[MsaRecord] = []
    current_id: str | None = None
    current: list[str] = []
    for raw in text.splitlines():
        line = raw.strip()
        if not line:
            continue
        if line.startswith(">"):
            if current_id is not None:
                records.append(MsaRecord(current_id, "".join(current).upper()))
            current_id = line[1:].split()[0]
            current = []
            continue
        if current_id is None:
            raise MsaError("MAFFT output sequence appears before a FASTA header")
        current.append(line)
    if current_id is not None:
        records.append(MsaRecord(current_id, "".join(current).upper()))

    if len(records) != len(original_sequences):
        raise MsaError("MAFFT output sequence count does not match the request")
    aligned_lengths = {len(record.sequence) for record in records}
    if len(aligned_lengths) != 1 or next(iter(aligned_lengths), 0) < 1:
        raise MsaError("MAFFT output records do not share one aligned length")

    by_index: dict[int, MsaRecord] = {}
    for record in records:
        match = _ID_RE.fullmatch(record.record_id)
        if match is None:
            raise MsaError("MAFFT output contains an unexpected sequence identifier")
        index = int(match.group(1))
        if index in by_index or index < 1 or index > len(original_sequences):
            raise MsaError("MAFFT output sequence identifiers are invalid")
        if any(ch.isspace() for ch in record.sequence):
            raise MsaError("MAFFT output contains whitespace inside a sequence")
        ungapped = record.sequence.replace("-", "").replace(".", "")
        if ungapped.upper() != original_sequences[index - 1].upper():
            raise MsaError("MAFFT output failed input-sequence integrity validation")
        by_index[index] = record

    return [by_index[i] for i in range(1, len(original_sequences) + 1)]


def run_mafft(sequences: list[str], *, timeout_seconds: int = 300) -> bytes:
    input_bytes = build_mafft_input(sequences)
    with tempfile.TemporaryDirectory(prefix="genithm-msa-") as tempdir:
        input_path = Path(tempdir) / "input.fasta"
        input_path.write_bytes(input_bytes)
        try:
            completed = subprocess.run(
                ["/usr/bin/mafft", "--auto", "--thread", "1", "--quiet", str(input_path)],
                stdin=subprocess.DEVNULL,
                stdout=subprocess.PIPE,
                stderr=subprocess.PIPE,
                check=False,
                timeout=timeout_seconds,
                shell=False,
            )
        except subprocess.TimeoutExpired as exc:
            raise MsaError("MAFFT execution exceeded the approved timeout") from exc
        if completed.returncode != 0:
            raise MsaError("MAFFT execution failed")
        records = parse_alignment(completed.stdout, sequences)
        chunks: list[str] = []
        for record in records:
            chunks.extend((f">{record.record_id}", record.sequence))
        result = ("\n".join(chunks) + "\n").encode("ascii")
        if len(result) > MAX_ALIGNMENT_BYTES:
            raise MsaError("normalized MSA result exceeds approved result size")
        return result
