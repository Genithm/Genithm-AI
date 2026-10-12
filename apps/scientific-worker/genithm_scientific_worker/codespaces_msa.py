from __future__ import annotations

"""Local-only bounded MAFFT MSA, conservation and FastTree inference.

Never registered as a production AI dispatch tool or scientific queue job.
"""
import hashlib
import math
import re
import shutil
import subprocess
from collections import Counter
from dataclasses import dataclass
from typing import Any
from .msa import MsaError, parse_alignment, run_mafft

MAX_INPUT_CHARS = 5500
MAX_RECORDS = 8
MAX_BASES_PER_RECORD = 300
MAX_ALIGNED_COLUMNS = 600
MAX_TREE_BYTES = 8192
ALPHABETS = {"dna": frozenset("ACGTN"), "rna": frozenset("ACGUN")}
ID_PATTERN = re.compile(r"[A-Za-z][A-Za-z0-9_.-]{0,39}\Z")
OPERATIONS = frozenset(("msa_conservation", "msa_phylogeny"))
TOOL_ID = "genithm-local-mafft-fasttree"
TOOL_VERSION = "1.0.0"

@dataclass(frozen=True)
class InputRecord:
    name: str
    sequence: str

def parse_records(source: object, sequence_type: object) -> list[InputRecord]:
    if not isinstance(source, str) or not 1 <= len(source) <= MAX_INPUT_CHARS:
        raise ValueError("MSA input must be 1-5500 characters")
    if not isinstance(sequence_type, str) or sequence_type not in ALPHABETS:
        raise ValueError("MSA requires one selected DNA or RNA type")
    records: list[InputRecord] = []
    name: str | None = None
    parts: list[str] = []
    def flush() -> None:
        if name is None:
            return
        bases = "".join(parts)
        if not 1 <= len(bases) <= MAX_BASES_PER_RECORD:
            raise ValueError("each MSA input must contain 1-300 nucleotides")
        if not frozenset(bases) <= ALPHABETS[sequence_type]:
            raise ValueError("MSA input contains gaps or non-DNA/RNA symbols")
        records.append(InputRecord(name, bases))
    for raw in source.splitlines():
        line = raw.strip()
        if not line:
            continue
        if line.startswith(">"):
            flush()
            if len(records) >= MAX_RECORDS:
                raise ValueError("maximum eight MSA records")
            name = line[1:]
            if not ID_PATTERN.fullmatch(name):
                raise ValueError("FASTA IDs must be unique, simple and 1-40 characters")
            parts = []
        else:
            if name is None:
                raise ValueError("MSA requires named FASTA records")
            parts.append("".join(line.upper().split()))
    flush()
    if not 3 <= len(records) <= MAX_RECORDS:
        raise ValueError("MSA needs three to eight named FASTA records")
    if len({record.name for record in records}) != len(records):
        raise ValueError("duplicate FASTA IDs are not allowed")
    return records

def conservation_profile(aligned: list[str], names: list[str]) -> dict[str, Any]:
    if not 3 <= len(aligned) <= MAX_RECORDS or len(aligned) != len(names):
        raise ValueError("invalid alignment record count")
    lengths = {len(seq) for seq in aligned}
    if len(lengths) != 1:
        raise ValueError("MAFFT returned inconsistent alignment lengths")
    length = next(iter(lengths))
    if not 1 <= length <= MAX_ALIGNED_COLUMNS:
        raise ValueError("alignment has too many columns")
    if any(set(seq) - set("ACGTN-") for seq in aligned):
        raise ValueError("MAFFT returned unexpected nucleotide symbols")
    total = len(aligned)
    sites: list[dict[str, Any]] = []
    fully_conserved = variable = all_gap = informative = 0
    consensus: list[str] = []
    for pos, letters in enumerate(zip(*aligned, strict=True), start=1):
        known = Counter(ch for ch in letters if ch in "ACGT")
        count_known = sum(known.values())
        gaps = letters.count("-")
        unknown = letters.count("N")
        if not count_known:
            all_gap += 1 if gaps == total else 0
            top_base, top_count, identity, entropy = "N", 0, None, None
        else:
            top_base, top_count = sorted(known.items(), key=lambda row: (-row[1], row[0]))[0]
            identity = round(100.0 * top_count / count_known, 2)
            entropy = round(-sum((n / count_known) * math.log2(n / count_known) for n in known.values()), 4)
            if len(known) >= 2:
                variable += 1
            if count_known == total and top_count == total:
                fully_conserved += 1
            if sum(n >= 2 for n in known.values()) >= 2:
                informative += 1
        consensus.append(top_base if count_known >= (total + 1) // 2 and top_count / max(1, count_known) >= 0.6 else "N")
        sites.append({
            "position": pos,
            "conservation_percent": identity,
            "gap_percent": round(100 * gaps / total, 2),
            "missing_percent": round(100 * (gaps + unknown) / total, 2),
            "known_bases": count_known,
            "entropy_bits": entropy,
            "consensus": consensus[-1],
        })
    valid = [s["conservation_percent"] for s in sites if s["conservation_percent"] is not None]
    return {
        "consensus": "".join(consensus),
        "sites": sites,
        "statistics": {
            "alignment_columns": length,
            "completely_conserved_columns": fully_conserved,
            "variable_columns": variable,
            "parsimony_informative_columns": informative,
            "all_gap_columns": all_gap,
            "mean_known_base_conservation_percent": round(sum(valid) / len(valid), 2) if valid else None,
        },
        "method": "Column-wise majority A/C/G/T frequency among known bases; N and gaps excluded. "
                  "Fully conserved requires every sequence known and identical. "
                  "Consensus is N unless at least half are known and one base dominates >=60%.",
    }

class _Newick:
    """Strict Newick parser with bounded recursion and verified leaf provenance."""
    def __init__(self, data: str, names: list[str]):
        if not 1 <= len(data) <= MAX_TREE_BYTES:
            raise ValueError("FastTree output has an invalid size")
        self.text = data.strip()
        self.i = 0
        self.names = names
        self.seen: set[int] = set()
        self.next_id = 0

    def _token(self) -> str:
        start = self.i
        while self.i < len(self.text) and self.text[self.i] not in ",():;":
            self.i += 1
        return self.text[start:self.i].strip()

    def _length(self) -> float:
        if self.i >= len(self.text) or self.text[self.i] != ":":
            return 0.0
        self.i += 1
        token = self._token()
        if not re.fullmatch(r"(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?", token):
            raise ValueError("FastTree returned an invalid branch length")
        value = float(token)
        if not math.isfinite(value) or value < 0 or value > 1e9:
            raise ValueError("FastTree returned an invalid branch length")
        return value

    def node(self, depth: int = 0) -> dict[str, Any]:
        if depth > 2 * MAX_RECORDS:
            raise ValueError("FastTree tree exceeds depth limit")
        ident = self.next_id
        self.next_id += 1
        children: list[dict[str, Any]] = []
        support = None
        if self.i < len(self.text) and self.text[self.i] == "(":
            self.i += 1
            children.append(self.node(depth + 1))
            while self.i < len(self.text) and self.text[self.i] == ",":
                self.i += 1
                children.append(self.node(depth + 1))
            if self.i >= len(self.text) or self.text[self.i] != ")" or len(children) < 2:
                raise ValueError("FastTree returned invalid Newick branching")
            self.i += 1
            label = self._token()
            if label:
                try:
                    parsed_support = float(label)
                except ValueError as exc:
                    raise ValueError("FastTree returned an invalid support label") from exc
                if not 0 <= parsed_support <= 1 or not math.isfinite(parsed_support):
                    raise ValueError("FastTree returned invalid split support")
                support = round(parsed_support, 4)
            name = None
        else:
            token = self._token()
            if not re.fullmatch(r"seq[1-8]", token):
                raise ValueError("FastTree tree contains an unexpected tip")
            index = int(token[3:]) - 1
            if index >= len(self.names) or index in self.seen:
                raise ValueError("FastTree tree contains duplicate or missing tips")
            self.seen.add(index)
            name = self.names[index]
        return {"id": ident, "name": name, "children": children,
                "length": self._length(), "support": support}

    def parse(self) -> dict[str, Any]:
        root = self.node()
        if self.i >= len(self.text) or self.text[self.i] != ";" or self.i + 1 != len(self.text):
            raise ValueError("FastTree tree is not a complete Newick statement")
        if self.seen != set(range(len(self.names))):
            raise ValueError("FastTree tree has missing tips")
        if len(self.names) > MAX_RECORDS or self.next_id > 2 * MAX_RECORDS + 2:
            raise ValueError("FastTree tree is too large")
        return root

def _run_fasttree(aligned: list[str]) -> str:
    path = shutil.which("FastTree") or shutil.which("fasttree")
    if not path:
        raise ValueError("FastTree missing; install it using .devcontainer/setup.sh")
    fasta = "".join(f">seq{i}\n{s}\n" for i, s in enumerate(aligned, start=1))
    try:
        result = subprocess.run([path, "-nt", "-quiet"], input=fasta.encode("ascii"),
                                capture_output=True, timeout=18, check=False)
    except subprocess.TimeoutExpired as exc:
        raise ValueError("FastTree exceeded the local time budget") from exc
    except OSError as exc:
        raise ValueError("FastTree is unavailable or cannot start") from exc
    if result.returncode != 0 or not result.stdout or len(result.stdout) > MAX_TREE_BYTES:
        raise ValueError("FastTree could not produce a bounded tree")
    try:
        return result.stdout.decode("ascii").strip()
    except UnicodeDecodeError as exc:
        raise ValueError("FastTree output was not ASCII") from exc

def run_local_msa(payload: object) -> dict[str, Any]:
    if not isinstance(payload, dict) or set(payload) != {
        "sequence", "sequence_type", "operation", "motif", "min_aa"
    }:
        raise ValueError("invalid MSA request shape")
    operation = payload["operation"]
    if not isinstance(operation, str) or operation not in OPERATIONS:
        raise ValueError("unsupported MSA operation")
    if payload["motif"] is not None or type(payload["min_aa"]) is not int or payload["min_aa"] != 30:
        raise ValueError("MSA parameters must use approved defaults")
    records = parse_records(payload["sequence"], payload["sequence_type"])
    normalized = [record.sequence.replace("U", "T") for record in records]
    try:
        raw = run_mafft(normalized, timeout_seconds=22)
        checked = parse_alignment(raw, normalized)
    except (MsaError, OSError) as exc:
        raise ValueError("MAFFT unavailable or failed output integrity checks") from exc
    aligned = [row.sequence.replace(".", "-") for row in checked]
    if any(len(entry) > MAX_ALIGNED_COLUMNS for entry in aligned):
        raise ValueError("alignment exceeds local 600-column limit")
    names = [record.name for record in records]
    profile = conservation_profile(aligned, names)
    newick = tree = None
    if operation == "msa_phylogeny":
        newick = _run_fasttree(aligned)
        tree = _Newick(newick, names).parse()
    canonical = "".join(f">{record.name}\n{record.sequence}\n" for record in records)
    return {
        "mode": "local-development-only", "persistence": "none",
        "tool": {"id": TOOL_ID, "version": TOOL_VERSION,
                 "aligner": "MAFFT", "tree_builder": "FastTree" if tree else None},
        "input_sha256": hashlib.sha256(canonical.encode("ascii")).hexdigest(),
        "summary": {"operation": operation, "sequence_type": payload["sequence_type"],
                    "sequence_count": len(records),
                    "input_bases": sum(len(item.sequence) for item in records),
                    **profile["statistics"]},
        "result": {"records": [{"name": record.name, "aligned": aligned[i],
                                "input_length": len(record.sequence)}
                               for i, record in enumerate(records)],
                   "conservation": profile["sites"], "consensus": profile["consensus"],
                   "method": profile["method"], "newick": newick, "tree": tree,
                   "phylogeny_note": "FastTree estimates an unrooted approximate maximum-likelihood tree; "
                                     "the rectangular display does not assign a biological root." if tree else None},
    }
