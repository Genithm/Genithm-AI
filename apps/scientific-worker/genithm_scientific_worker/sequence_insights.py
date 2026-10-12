from __future__ import annotations

import json
from dataclasses import dataclass
from hashlib import sha256

TOOL_ID = "genithm-sequence-insights"
TOOL_VERSION = "0.1.0"
EXECUTOR_VERSION = "genithm-scientific-worker/0.5.0"
MAX_BASES = 50000
MAX_ORFS = 100
MAX_MOTIF_HITS = 1000
OPERATIONS = frozenset({"orf_scan", "six_frame_translation", "motif_scan", "reverse_complement"})
DNA_COMPLEMENTS = str.maketrans("ACGTN", "TGCAN")
RNA_COMPLEMENTS = str.maketrans("ACGUN", "UGCAN")
CODON_BASES = "TCAG"
AMINO_ACIDS = "FFLLSSSSYY**CC*WLLLLPPPPHHQQRRRRIIIMTTTTNNKKSSRRVVVVAAAADDEEGGGG"
CODONS = {
    a + b + c: aa
    for a, b, c, aa in zip(
        (a for a in CODON_BASES for _b in CODON_BASES for _c in CODON_BASES),
        (b for _a in CODON_BASES for b in CODON_BASES for _c in CODON_BASES),
        (c for _a in CODON_BASES for _b in CODON_BASES for c in CODON_BASES),
        AMINO_ACIDS,
        strict=True,
    )
}
IUPAC = {
    "A": frozenset("A"), "C": frozenset("C"), "G": frozenset("G"),
    "T": frozenset("T"), "U": frozenset("T"), "R": frozenset("AG"),
    "Y": frozenset("CT"), "S": frozenset("GC"), "W": frozenset("AT"),
    "K": frozenset("GT"), "M": frozenset("AC"), "B": frozenset("CGT"),
    "D": frozenset("AGT"), "H": frozenset("ACT"), "V": frozenset("ACG"),
    "N": frozenset("ACGTN"),
}


class SequenceInsightsError(ValueError):
    pass


@dataclass(frozen=True, slots=True)
class SequenceInput:
    sequence: str
    sequence_type: str


def parse_nucleotide_fasta(data: bytes, *, sequence_type: str) -> SequenceInput:
    if sequence_type not in {"dna", "rna"}:
        raise SequenceInsightsError("sequence insights require a DNA or RNA input")
    if not data or len(data) > 2 * 1024 * 1024:
        raise SequenceInsightsError("FASTA input is empty or exceeds worker read limit")
    try:
        text = data.decode("utf-8-sig")
    except UnicodeDecodeError as exc:
        raise SequenceInsightsError("FASTA must be valid UTF-8") from exc

    headers = 0
    bases: list[str] = []
    for raw_line in text.splitlines():
        line = raw_line.strip()
        if not line:
            continue
        if line.startswith(">"):
            headers += 1
            if headers > 1:
                raise SequenceInsightsError("exactly one FASTA record is required")
            continue
        if headers != 1:
            raise SequenceInsightsError("FASTA sequence appears before header")
        bases.append("".join(line.upper().split()))

    sequence = "".join(bases)
    if headers != 1 or not sequence:
        raise SequenceInsightsError("FASTA requires one nonempty record")
    if len(sequence) > MAX_BASES:
        raise SequenceInsightsError("sequence exceeds 50000-base compute bound")
    alphabet = frozenset("ACGTN") if sequence_type == "dna" else frozenset("ACGUN")
    if not frozenset(sequence) <= alphabet:
        raise SequenceInsightsError("sequence contains unsupported or gapped nucleotide symbols")
    return SequenceInput(sequence=sequence, sequence_type=sequence_type)


def reverse_complement(sequence: str, *, sequence_type: str) -> str:
    if sequence_type == "dna":
        if not frozenset(sequence) <= frozenset("ACGTN"):
            raise SequenceInsightsError("invalid DNA sequence")
        return sequence.translate(DNA_COMPLEMENTS)[::-1]
    if sequence_type == "rna":
        if not frozenset(sequence) <= frozenset("ACGUN"):
            raise SequenceInsightsError("invalid RNA sequence")
        return sequence.translate(RNA_COMPLEMENTS)[::-1]
    raise SequenceInsightsError("invalid nucleotide type")


def _translate_dna(sequence: str) -> str:
    return "".join(CODONS.get(sequence[i:i + 3], "X") for i in range(0, len(sequence) - 2, 3))


def six_frame_translation(sequence: str, sequence_type: str) -> list[dict[str, object]]:
    forward = sequence.replace("U", "T")
    reverse = reverse_complement(sequence, sequence_type=sequence_type).replace("U", "T")
    return [
        {"strand": strand, "frame": frame + 1, "protein": _translate_dna(oriented[frame:])}
        for strand, oriented in (("+", forward), ("-", reverse))
        for frame in range(3)
    ]


def scan_orfs(sequence: str, *, sequence_type: str, min_aa: int) -> tuple[list[dict[str, object]], int]:
    if isinstance(min_aa, bool) or not isinstance(min_aa, int) or not 1 <= min_aa <= 1000:
        raise SequenceInsightsError("minimum ORF length must be between 1 and 1000 amino acids")
    forward = sequence.replace("U", "T")
    reverse = reverse_complement(sequence, sequence_type=sequence_type).replace("U", "T")
    length = len(sequence)
    candidates: list[tuple[int, str, int, int, int, str]] = []
    count = 0
    for strand, oriented in (("+", forward), ("-", reverse)):
        for frame in range(3):
            starts: list[int] = []
            for position in range(frame, len(oriented) - 2, 3):
                codon = oriented[position:position + 3]
                if codon == "ATG":
                    starts.append(position)
                elif codon in {"TAA", "TAG", "TGA"}:
                    for start in starts:
                        aa_length = (position - start) // 3
                        if aa_length < min_aa:
                            continue
                        count += 1
                        if strand == "+":
                            coordinate_start, coordinate_end = start + 1, position + 3
                        else:
                            coordinate_start = length - (position + 3) + 1
                            coordinate_end = length - start
                        if len(candidates) < MAX_ORFS:
                            candidates.append((aa_length, strand, frame + 1, coordinate_start, coordinate_end, oriented[start:position]))
                    starts = []
    candidates.sort(key=lambda item: (-item[0], item[1], item[3], item[4], item[2]))
    orfs = [
        {
            "start_1based": start,
            "end_1based": end,
            "strand": strand,
            "frame": frame,
            "amino_acids": aa_length,
            "protein": _translate_dna(coding),
        }
        for aa_length, strand, frame, start, end, coding in candidates
    ]
    return orfs, count


def scan_motif(sequence: str, *, sequence_type: str, motif: str) -> tuple[list[dict[str, object]], int]:
    if not isinstance(motif, str):
        raise SequenceInsightsError("motif must be text")
    motif = motif.strip().upper().replace("U", "T")
    if not 2 <= len(motif) <= 32 or any(ch not in IUPAC for ch in motif):
        raise SequenceInsightsError("motif must be 2-32 IUPAC nucleotide symbols")
    matches: list[dict[str, object]] = []
    total = 0
    for strand, oriented in (("+", sequence), ("-", reverse_complement(sequence, sequence_type=sequence_type))):
        dna = oriented.replace("U", "T")
        for offset in range(len(dna) - len(motif) + 1):
            if all(dna[offset + j] in IUPAC[code] for j, code in enumerate(motif)):
                total += 1
                if len(matches) < MAX_MOTIF_HITS:
                    start = offset + 1 if strand == "+" else len(dna) - offset - len(motif) + 1
                    matches.append({
                        "start_1based": start,
                        "end_1based": start + len(motif) - 1,
                        "strand": strand,
                    })
    matches.sort(key=lambda item: (item["start_1based"], item["strand"]))
    return matches, total


def analyze(sequence_input: SequenceInput, *, operation: str, motif: str | None = None, min_aa: int = 30) -> tuple[dict[str, object], dict[str, object]]:
    if operation not in OPERATIONS:
        raise SequenceInsightsError("unapproved sequence insight operation")
    sequence = sequence_input.sequence
    summary: dict[str, object] = {
        "job_type": "sequence_insights",
        "operation": operation,
        "sequence_type": sequence_input.sequence_type,
        "sequence_length": len(sequence),
    }
    result: dict[str, object] = {"operation": operation, "coordinate_system": "1-based inclusive"}
    if operation == "orf_scan":
        orfs, total = scan_orfs(sequence, sequence_type=sequence_input.sequence_type, min_aa=min_aa)
        summary.update({"orf_count": total, "reported_orfs": len(orfs), "min_aa": min_aa})
        result.update({"orfs": orfs, "truncated": total > len(orfs)})
    elif operation == "six_frame_translation":
        result["frames"] = six_frame_translation(sequence, sequence_input.sequence_type)
        summary["frame_count"] = 6
    elif operation == "motif_scan":
        if motif is None:
            raise SequenceInsightsError("motif is required for motif scan")
        normalized_motif = motif.strip().upper().replace("U", "T")
        hits, total = scan_motif(sequence, sequence_type=sequence_input.sequence_type, motif=normalized_motif)
        summary.update({"motif": normalized_motif, "motif_hits": total, "reported_hits": len(hits)})
        result.update({"hits": hits, "truncated": total > len(hits)})
    else:
        transformed = reverse_complement(sequence, sequence_type=sequence_input.sequence_type)
        result["reverse_complement"] = transformed
        summary["output_length"] = len(transformed)
    return summary, result


def canonical_sequence_insights_result(job: dict[str, object], sequence_input: SequenceInput) -> tuple[bytes, dict[str, object], dict[str, object]]:
    params = job.get("parameters")
    inputs = job.get("inputs")
    if not isinstance(params, dict) or not isinstance(inputs, list) or len(inputs) != 1:
        raise SequenceInsightsError("sequence insights job requires exactly one authorized input")
    if set(params) != {"operation", "motif", "min_aa"}:
        raise SequenceInsightsError("sequence insights parameter contract mismatch")
    operation = params.get("operation")
    motif = params.get("motif")
    min_aa = params.get("min_aa")
    if not isinstance(operation, str) or (motif is not None and not isinstance(motif, str)):
        raise SequenceInsightsError("invalid sequence insights parameters")
    if isinstance(min_aa, bool) or not isinstance(min_aa, int):
        raise SequenceInsightsError("invalid minimum ORF length")
    if operation != "motif_scan" and motif is not None:
        raise SequenceInsightsError("unexpected motif for operation")
    if operation != "orf_scan" and min_aa != 30:
        raise SequenceInsightsError("unexpected ORF minimum for operation")
    if job.get("tool_id") != TOOL_ID or job.get("tool_version") != TOOL_VERSION:
        raise SequenceInsightsError("job does not match approved sequence insights tool")
    if inputs[0].get("sequence_type") != sequence_input.sequence_type:
        raise SequenceInsightsError("input sequence type differs from verified provenance")

    summary, result = analyze(sequence_input, operation=operation, motif=motif, min_aa=min_aa)
    summary["input_sha256"] = str(inputs[0]["sha256"])
    provenance = {
        "tool_id": TOOL_ID,
        "tool_version": TOOL_VERSION,
        "executor_version": EXECUTOR_VERSION,
        "request_fingerprint": str(job["request_fingerprint"]),
        "parameters": params,
        "inputs": [{
            "position": int(inputs[0]["position"]),
            "role": str(inputs[0]["role"]),
            "sha256": str(inputs[0]["sha256"]),
        }],
        "genetic_code": "NCBI_translation_table_1",
        "source": "input_verified_by_sha256",
    }
    artifact = {
        "schema_version": "genithm-sequence-insights/1",
        "summary": summary,
        "result": result,
        "provenance": provenance,
    }
    data = json.dumps(artifact, sort_keys=True, separators=(",", ":"), ensure_ascii=True).encode("utf-8")
    if len(data) > 25 * 1024 * 1024:
        raise SequenceInsightsError("computed result exceeds allowed artifact size")
    return data, summary, provenance
