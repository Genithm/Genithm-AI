from __future__ import annotations

import math
from collections import Counter
from dataclasses import dataclass

TOOL_ID = "genithm-protein-properties"
TOOL_VERSION = "0.1.0"
EXECUTOR_VERSION = "genithm-scientific-worker/0.4.0"
CANONICAL_AMINO_ACIDS = frozenset("ACDEFGHIKLMNPQRSTVWY")
WATER_MASS = 18.01528

# Average residue masses in daltons after peptide-bond formation.
AVERAGE_RESIDUE_MASS = {
    "A": 71.0788,
    "R": 156.1875,
    "N": 114.1038,
    "D": 115.0886,
    "C": 103.1388,
    "E": 129.1155,
    "Q": 128.1307,
    "G": 57.0519,
    "H": 137.1411,
    "I": 113.1594,
    "L": 113.1594,
    "K": 128.1741,
    "M": 131.1926,
    "F": 147.1766,
    "P": 97.1167,
    "S": 87.0782,
    "T": 101.1051,
    "W": 186.2132,
    "Y": 163.1760,
    "V": 99.1326,
}

KYTE_DOOLITTLE = {
    "A": 1.8, "R": -4.5, "N": -3.5, "D": -3.5, "C": 2.5,
    "Q": -3.5, "E": -3.5, "G": -0.4, "H": -3.2, "I": 4.5,
    "L": 3.8, "K": -3.9, "M": 1.9, "F": 2.8, "P": -1.6,
    "S": -0.8, "T": -0.7, "W": -0.9, "Y": -1.3, "V": 4.2,
}

# Fixed pKa set for Genithm V1. This is an estimate model, not an experimental pI.
PKA = {
    "n_term": 9.69,
    "c_term": 2.34,
    "D": 3.86,
    "E": 4.25,
    "C": 8.33,
    "Y": 10.07,
    "H": 6.00,
    "K": 10.53,
    "R": 12.48,
}


class ProteinPropertiesError(ValueError):
    pass


@dataclass(frozen=True, slots=True)
class ProteinProperties:
    length: int
    amino_acid_composition: dict[str, int]
    molecular_weight_da: float
    aromaticity_fraction: float
    gravy: float
    estimated_net_charge_ph7: float
    estimated_isoelectric_point: float


def parse_single_protein_fasta(data: bytes) -> str:
    if not data or len(data) > 2 * 1024 * 1024:
        raise ProteinPropertiesError("protein FASTA input is empty or exceeds worker read limit")
    try:
        text = data.decode("utf-8-sig")
    except UnicodeDecodeError as exc:
        raise ProteinPropertiesError("protein FASTA input must be UTF-8 text") from exc

    headers = 0
    sequence: list[str] = []
    for raw in text.splitlines():
        line = raw.strip()
        if not line:
            continue
        if line.startswith(">"):
            headers += 1
            if headers > 1:
                raise ProteinPropertiesError("protein properties require exactly one FASTA record")
            continue
        if headers != 1:
            raise ProteinPropertiesError("protein sequence appears before FASTA header")
        sequence.extend(ch.upper() for ch in line if not ch.isspace())

    result = "".join(sequence)
    if headers != 1 or not result:
        raise ProteinPropertiesError("protein FASTA must contain exactly one non-empty record")
    if len(result) > 200_000:
        raise ProteinPropertiesError("protein sequence exceeds V1 residue limit")
    invalid = sorted(set(result) - CANONICAL_AMINO_ACIDS)
    if invalid:
        raise ProteinPropertiesError(
            "protein properties V1 requires canonical 20-amino-acid sequence; unsupported symbols: "
            + "".join(invalid)
        )
    return result


def _net_charge(sequence: str, ph: float) -> float:
    counts = Counter(sequence)
    positive = 1.0 / (1.0 + 10 ** (ph - PKA["n_term"]))
    positive += counts["K"] / (1.0 + 10 ** (ph - PKA["K"]))
    positive += counts["R"] / (1.0 + 10 ** (ph - PKA["R"]))
    positive += counts["H"] / (1.0 + 10 ** (ph - PKA["H"]))

    negative = 1.0 / (1.0 + 10 ** (PKA["c_term"] - ph))
    negative += counts["D"] / (1.0 + 10 ** (PKA["D"] - ph))
    negative += counts["E"] / (1.0 + 10 ** (PKA["E"] - ph))
    negative += counts["C"] / (1.0 + 10 ** (PKA["C"] - ph))
    negative += counts["Y"] / (1.0 + 10 ** (PKA["Y"] - ph))
    return positive - negative


def estimate_isoelectric_point(sequence: str) -> float:
    low, high = 0.0, 14.0
    for _ in range(80):
        mid = (low + high) / 2.0
        charge = _net_charge(sequence, mid)
        if charge > 0:
            low = mid
        else:
            high = mid
    result = (low + high) / 2.0
    if not math.isfinite(result):
        raise ProteinPropertiesError("estimated isoelectric point is not finite")
    return result


def calculate_protein_properties(sequence: str) -> ProteinProperties:
    if not sequence:
        raise ProteinPropertiesError("protein sequence must not be empty")
    invalid = set(sequence) - CANONICAL_AMINO_ACIDS
    if invalid:
        raise ProteinPropertiesError("protein property calculation received unsupported amino-acid symbols")

    counts = Counter(sequence)
    composition = {aa: counts.get(aa, 0) for aa in sorted(CANONICAL_AMINO_ACIDS)}
    length = len(sequence)
    molecular_weight = sum(AVERAGE_RESIDUE_MASS[aa] for aa in sequence) + WATER_MASS
    aromaticity = (counts["F"] + counts["W"] + counts["Y"]) / length
    gravy = sum(KYTE_DOOLITTLE[aa] for aa in sequence) / length
    charge7 = _net_charge(sequence, 7.0)
    pi_value = estimate_isoelectric_point(sequence)

    values = [molecular_weight, aromaticity, gravy, charge7, pi_value]
    if not all(math.isfinite(value) for value in values):
        raise ProteinPropertiesError("protein property calculation produced a non-finite result")

    return ProteinProperties(
        length=length,
        amino_acid_composition=composition,
        molecular_weight_da=round(molecular_weight, 6),
        aromaticity_fraction=round(aromaticity, 9),
        gravy=round(gravy, 9),
        estimated_net_charge_ph7=round(charge7, 9),
        estimated_isoelectric_point=round(pi_value, 9),
    )
