from __future__ import annotations

import math
import re
import subprocess
import tempfile
from dataclasses import dataclass
from pathlib import Path

TOOL_ID = "fasttree"
TOOL_VERSION = "2.1.11-2"
EXECUTOR_VERSION = "genithm-scientific-worker/0.3.0"
MAX_SEQUENCES = 50
MAX_ALIGNMENT_BYTES = 25 * 1024 * 1024
MAX_TREE_BYTES = 4 * 1024 * 1024
_ID_RE = re.compile(r"^seq([1-9][0-9]*)$")
_NUMBER_RE = re.compile(r"^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?$")


class PhylogenyError(ValueError):
    pass


@dataclass(frozen=True, slots=True)
class TreeMetrics:
    leaf_count: int
    internal_support_count: int


def validate_alignment(data: bytes, expected_count: int) -> bytes:
    if expected_count < 3 or expected_count > MAX_SEQUENCES:
        raise PhylogenyError("phylogeny requires between 3 and 50 aligned sequences")
    if not data or len(data) > MAX_ALIGNMENT_BYTES:
        raise PhylogenyError("source MSA artifact is empty or exceeds the approved size")
    try:
        text = data.decode("ascii")
    except UnicodeDecodeError as exc:
        raise PhylogenyError("source MSA artifact must be ASCII FASTA") from exc

    records: list[tuple[str, str]] = []
    current_id: str | None = None
    current: list[str] = []
    for raw in text.splitlines():
        line = raw.strip()
        if not line:
            continue
        if line.startswith(">"):
            if current_id is not None:
                records.append((current_id, "".join(current).upper()))
            current_id = line[1:].split()[0]
            current = []
            continue
        if current_id is None:
            raise PhylogenyError("source MSA contains sequence data before a FASTA header")
        current.append(line)
    if current_id is not None:
        records.append((current_id, "".join(current).upper()))

    if len(records) != expected_count:
        raise PhylogenyError("source MSA sequence count does not match provenance")
    lengths = {len(sequence) for _, sequence in records}
    if len(lengths) != 1 or next(iter(lengths), 0) < 1:
        raise PhylogenyError("source MSA records must share one non-zero aligned length")

    seen: set[int] = set()
    for record_id, sequence in records:
        match = _ID_RE.fullmatch(record_id)
        if match is None:
            raise PhylogenyError("source MSA contains an unexpected sequence identifier")
        index = int(match.group(1))
        if index < 1 or index > expected_count or index in seen:
            raise PhylogenyError("source MSA identifiers are duplicated or outside provenance bounds")
        seen.add(index)
        if any(ch.isspace() for ch in sequence):
            raise PhylogenyError("source MSA contains whitespace inside an aligned sequence")
        if any(ord(ch) < 33 or ord(ch) > 126 for ch in sequence):
            raise PhylogenyError("source MSA contains non-printable sequence content")

    if seen != set(range(1, expected_count + 1)):
        raise PhylogenyError("source MSA identifiers do not match expected inputs")

    normalized: list[str] = []
    by_index = {int(_ID_RE.fullmatch(record_id).group(1)): sequence for record_id, sequence in records}  # type: ignore[union-attr]
    for index in range(1, expected_count + 1):
        normalized.extend((f">seq{index}", by_index[index]))
    return ("\n".join(normalized) + "\n").encode("ascii")


class _NewickParser:
    def __init__(self, text: str, expected_count: int) -> None:
        self.text = text
        self.expected_count = expected_count
        self.pos = 0
        self.leaves: set[int] = set()
        self.support_count = 0

    def _skip_ws(self) -> None:
        while self.pos < len(self.text) and self.text[self.pos].isspace():
            self.pos += 1

    def _peek(self) -> str:
        self._skip_ws()
        return self.text[self.pos] if self.pos < len(self.text) else ""

    def _token(self) -> str:
        self._skip_ws()
        start = self.pos
        while self.pos < len(self.text) and self.text[self.pos] not in "(),:;\t\r\n ":
            self.pos += 1
        if self.pos == start:
            raise PhylogenyError("FastTree output contains a malformed Newick token")
        return self.text[start:self.pos]

    def _number(self, *, branch_length: bool) -> float:
        token = self._token()
        if _NUMBER_RE.fullmatch(token) is None:
            raise PhylogenyError("FastTree output contains a non-numeric branch/support value")
        value = float(token)
        if not math.isfinite(value):
            raise PhylogenyError("FastTree output contains a non-finite branch/support value")
        if branch_length and value < 0:
            raise PhylogenyError("FastTree output contains a negative branch length")
        return value

    def _branch(self) -> None:
        if self._peek() == ":":
            self.pos += 1
            self._number(branch_length=True)

    def _subtree(self) -> None:
        if self._peek() == "(":
            self.pos += 1
            child_count = 0
            while True:
                self._subtree()
                child_count += 1
                next_char = self._peek()
                if next_char == ",":
                    self.pos += 1
                    continue
                if next_char == ")":
                    self.pos += 1
                    break
                raise PhylogenyError("FastTree output contains malformed Newick branching")
            if child_count < 2:
                raise PhylogenyError("FastTree output contains a unary internal node")
            next_char = self._peek()
            if next_char not in {":", ",", ")", ";", ""}:
                support = self._number(branch_length=False)
                if support < 0 or support > 1:
                    raise PhylogenyError("FastTree local support value is outside 0..1")
                self.support_count += 1
            self._branch()
            return

        label = self._token()
        match = _ID_RE.fullmatch(label)
        if match is None:
            raise PhylogenyError("FastTree output contains an unexpected leaf identifier")
        index = int(match.group(1))
        if index < 1 or index > self.expected_count or index in self.leaves:
            raise PhylogenyError("FastTree output leaf identifiers are duplicated or outside provenance bounds")
        self.leaves.add(index)
        self._branch()

    def parse(self) -> TreeMetrics:
        self._subtree()
        if self._peek() != ";":
            raise PhylogenyError("FastTree output must terminate with one Newick semicolon")
        self.pos += 1
        self._skip_ws()
        if self.pos != len(self.text):
            raise PhylogenyError("FastTree output contains trailing data after the Newick tree")
        expected = set(range(1, self.expected_count + 1))
        if self.leaves != expected:
            raise PhylogenyError("FastTree output leaves do not match the source MSA")
        return TreeMetrics(len(self.leaves), self.support_count)


def parse_newick(data: bytes, expected_count: int) -> tuple[bytes, TreeMetrics]:
    if not data or len(data) > MAX_TREE_BYTES:
        raise PhylogenyError("FastTree output is empty or exceeds the approved result size")
    try:
        text = data.decode("ascii").strip()
    except UnicodeDecodeError as exc:
        raise PhylogenyError("FastTree output must be ASCII Newick") from exc
    if not text or any(ord(ch) < 9 or (13 < ord(ch) < 32) or ord(ch) > 126 for ch in text):
        raise PhylogenyError("FastTree output contains invalid text content")
    parser = _NewickParser(text, expected_count)
    metrics = parser.parse()
    return (text + "\n").encode("ascii"), metrics


def run_fasttree(alignment: bytes, *, sequence_type: str, expected_count: int, timeout_seconds: int = 300) -> tuple[bytes, TreeMetrics, str]:
    normalized_alignment = validate_alignment(alignment, expected_count)
    if sequence_type not in {"dna", "rna", "protein"}:
        raise PhylogenyError("unsupported sequence type for phylogeny")
    model = "gtr_cat" if sequence_type in {"dna", "rna"} else "jtt_cat"

    with tempfile.TemporaryDirectory(prefix="genithm-tree-") as tempdir:
        input_path = Path(tempdir) / "alignment.fasta"
        input_path.write_bytes(normalized_alignment)
        command = ["/usr/bin/FastTree"]
        if sequence_type in {"dna", "rna"}:
            command.extend(["-nt", "-gtr"])
        command.append(str(input_path))
        try:
            completed = subprocess.run(
                command,
                stdin=subprocess.DEVNULL,
                stdout=subprocess.PIPE,
                stderr=subprocess.PIPE,
                check=False,
                timeout=timeout_seconds,
                shell=False,
            )
        except subprocess.TimeoutExpired as exc:
            raise PhylogenyError("FastTree execution exceeded the approved timeout") from exc
        if completed.returncode != 0:
            raise PhylogenyError("FastTree execution failed")
        tree, metrics = parse_newick(completed.stdout, expected_count)
        return tree, metrics, model
