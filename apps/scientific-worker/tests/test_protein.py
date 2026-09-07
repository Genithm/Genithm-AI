from __future__ import annotations

import pytest

from genithm_scientific_worker.protein import (
    ProteinPropertiesError,
    calculate_protein_properties,
    estimate_isoelectric_point,
    parse_single_protein_fasta,
)


def test_parse_single_protein_fasta_normalizes_case() -> None:
    assert parse_single_protein_fasta(b">protein\nacdefghiklmnpqrstvwy\n") == "ACDEFGHIKLMNPQRSTVWY"


def test_parser_rejects_multiple_records_gaps_and_ambiguous_symbols() -> None:
    with pytest.raises(ProteinPropertiesError, match="exactly one"):
        parse_single_protein_fasta(b">a\nACD\n>b\nEFG\n")
    with pytest.raises(ProteinPropertiesError, match="unsupported symbols"):
        parse_single_protein_fasta(b">a\nACD-EFG\n")
    with pytest.raises(ProteinPropertiesError, match="unsupported symbols"):
        parse_single_protein_fasta(b">a\nACDXEFG\n")
    with pytest.raises(ProteinPropertiesError, match="unsupported symbols"):
        parse_single_protein_fasta(b">a\nACD*EFG\n")


def test_properties_for_all_twenty_amino_acids_are_stable() -> None:
    result = calculate_protein_properties("ACDEFGHIKLMNPQRSTVWY")
    assert result.length == 20
    assert sum(result.amino_acid_composition.values()) == 20
    assert set(result.amino_acid_composition.values()) == {1}
    assert result.molecular_weight_da == pytest.approx(2395.73588, abs=1e-6)
    assert result.aromaticity_fraction == pytest.approx(0.15, abs=1e-9)
    assert result.gravy == pytest.approx(-0.49, abs=1e-9)
    assert -3.0 < result.estimated_net_charge_ph7 < 3.0
    assert 0.0 <= result.estimated_isoelectric_point <= 14.0


def test_hydrophobic_sequence_has_positive_gravy() -> None:
    result = calculate_protein_properties("ILVFM")
    assert result.gravy > 2.0
    assert result.aromaticity_fraction == pytest.approx(0.2)


def test_charge_and_pi_move_with_sequence_chemistry() -> None:
    acidic = calculate_protein_properties("DDDEEE")
    basic = calculate_protein_properties("KKKRRR")
    assert acidic.estimated_net_charge_ph7 < 0
    assert basic.estimated_net_charge_ph7 > 0
    assert acidic.estimated_isoelectric_point < basic.estimated_isoelectric_point


def test_pi_estimator_is_deterministic_and_bounded() -> None:
    first = estimate_isoelectric_point("MKWVTFISLLFLFSSAYS")
    second = estimate_isoelectric_point("MKWVTFISLLFLFSSAYS")
    assert first == pytest.approx(second, abs=1e-12)
    assert 0.0 <= first <= 14.0


def test_calculator_rejects_noncanonical_sequence() -> None:
    with pytest.raises(ProteinPropertiesError, match="unsupported"):
        calculate_protein_properties("ACDX")
