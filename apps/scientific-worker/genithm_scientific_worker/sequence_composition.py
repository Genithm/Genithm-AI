from __future__ import annotations

"""Bounded, deterministic exploratory statistics for single DNA/RNA FASTA records.

This module is intentionally descriptive: GC-rich windows are not asserted
to be CpG islands, genes, mutations, or clinically interpreted regions.
"""

import math
from collections import Counter

from .sequence_insights import CODONS, SequenceInput

VERSION = "genithm-local-composition/1.0.0"
MAX_WINDOWS = 101


def _pct(numerator: int, denominator: int) -> float | None:
    return round(100 * numerator / denominator, 2) if denominator else None


def _windows(sequence: str, window_size: int) -> list[dict[str, object]]:
    size = len(sequence)
    window = min(window_size, size)
    step = max(1, window // 2)
    offsets = list(range(0, size - window + 1, step))
    if offsets[-1] != size - window:
        offsets.append(size - window)
    if len(offsets) > MAX_WINDOWS:
        raise ValueError("GC profile exceeds plotting limit")
    result: list[dict[str, object]] = []
    for start in offsets:
        subsequence = sequence[start:start + window]
        canonical = sum(subsequence.count(base) for base in "ACGT")
        gc = subsequence.count("G") + subsequence.count("C")
        result.append({
            "start_1based": start + 1,
            "end_1based": start + window,
            "gc_percent": _pct(gc, canonical),
            "known_bases": canonical,
        })
    return result


def analyze_composition(item: SequenceInput) -> tuple[dict[str, object], dict[str, object]]:
    sequence = item.sequence.replace("U", "T")
    length = len(sequence)
    if not 1 <= length <= 5000:
        raise ValueError("composition profile requires 1-5000 nucleotides")
    if any(base not in "ACGTN" for base in sequence):
        raise ValueError("composition profile received invalid nucleotide alphabet")

    count = Counter(sequence)
    known = length - count["N"]
    gc = count["G"] + count["C"]
    at = count["A"] + count["T"]
    probabilities = [count[base] / known for base in "ACGT" if count[base] and known]
    entropy = round(-sum(p * math.log2(p) for p in probabilities), 4) if known else None

    cpg_count = sum(sequence[index:index+2] == "CG" for index in range(length-1))
    cpg_oe = (round(cpg_count * length / (count["C"] * count["G"]), 4)
              if count["C"] and count["G"] else None)

    # Fixed 100-base window and 50-base stride for long sequences; for short
    # sequences compute the only meaningful full-span window.
    window_size = min(100, length)
    gc_profile = _windows(sequence, window_size)

    # Codon usage is forward frame +1 only. The last 1 or 2 bases are excluded;
    # ambiguous codons are counted separately, not assigned an amino acid.
    codons = [sequence[i:i + 3] for i in range(0, length - 2, 3)]
    codon_counts = Counter(codons)
    ambiguous = sum("N" in codon for codon in codons)
    known_codons = [(codon, number) for codon, number in codon_counts.items() if "N" not in codon]
    known_codons.sort(key=lambda entry: (-entry[1], entry[0]))
    codon_usage = [{
        "codon": codon, "count": number, "amino_acid": CODONS[codon]
    } for codon, number in known_codons[:16]]

    # Overlapping trinucleotides, ignoring any N-containing window.
    trimers = Counter(
        sequence[index:index + 3]
        for index in range(length - 2)
        if "N" not in sequence[index:index + 3]
    )
    top_kmers = [
        {"kmer": kmer, "count": number}
        for kmer, number in sorted(trimers.items(), key=lambda entry: (-entry[1], entry[0]))[:12]
    ]

    original_t_or_u = "U" if item.sequence_type == "rna" else "T"
    summary: dict[str, object] = {
        "job_type": "local_composition_profile",
        "operation": "composition_profile",
        "sequence_type": item.sequence_type,
        "sequence_length": length,
        "known_bases": known,
        "gc_percent": _pct(gc, known),
        "at_percent": _pct(at, known),
        "n_percent": _pct(count["N"], length),
        "cpg_count": cpg_count,
        "cpg_observed_expected": cpg_oe,
        "shannon_entropy_bits": entropy,
        "gc_window_size": window_size,
        "gc_window_count": len(gc_profile),
        "forward_frame_1_codons": len(codons),
    }
    result: dict[str, object] = {
        "nucleotide_counts": {
            "A": count["A"], "C": count["C"], "G": count["G"],
            original_t_or_u: count["T"], "N": count["N"],
        },
        "gc_profile": gc_profile,
        "cpg_count": cpg_count,
        "cpg_observed_expected": cpg_oe,
        "codon_usage": codon_usage,
        "ambiguous_codons": ambiguous,
        "trailing_bases_excluded_from_codon_usage": length % 3,
        "top_trinucleotides": top_kmers,
        "methods": {
            "percent_denominator": "known A/C/G/T(U) bases, excluding N",
            "gc_window": "100 nt for length >=100; otherwise full length; 50% overlap, plus final window",
            "cpg": "observed contiguous CG dinucleotides on input strand",
            "cpg_oe": "observed_CpG * full_sequence_length / (C_count * G_count); null if C or G absent",
            "codons": "forward reading frame +1, standard NCBI genetic code 1; ambiguous codons excluded",
            "kmer": "overlapping unambiguous DNA-normalized trinucleotides on input strand",
            "interpretation": "exploratory sequence composition only; no gene, CpG-island, or clinical claims",
        },
    }
    return summary, result
