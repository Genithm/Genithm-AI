import pytest

from genithm_ai_worker.capability_registry import (
    SCIENTIFIC_DOMAINS,
    all_capabilities,
    available_capabilities,
    capabilities_by_domain,
    executable_action_types,
    get_capability,
)
from genithm_ai_worker.planner import ACTION_PARAMETER_KEYS, ALLOWED_ACTIONS


def test_capability_ids_are_unique():
    capabilities = all_capabilities()
    ids = [capability.capability_id for capability in capabilities]
    assert len(ids) == len(set(ids))


def test_every_capability_uses_known_domain():
    known_domains = set(SCIENTIFIC_DOMAINS)
    assert known_domains
    assert all(capability.domain in known_domains for capability in all_capabilities())


def test_available_capabilities_match_planner_action_contracts():
    executable = executable_action_types()
    assert executable == frozenset(ALLOWED_ACTIONS)
    assert executable == frozenset(ACTION_PARAMETER_KEYS)


def test_available_capabilities_are_not_planned_executors():
    assert available_capabilities()
    assert all(capability.execution_kind != "planned" for capability in available_capabilities())


def test_sequence_intelligence_capabilities_share_one_dispatch_contract():
    operations = {"orf_detection", "motif_scan", "six_frame_translation", "reverse_complement"}
    assert all(get_capability(capability_id).status == "available" for capability_id in operations)
    assert all(get_capability(capability_id).action_type == "sequence_insights" for capability_id in operations)
    assert "sequence_insights" in ALLOWED_ACTIONS
    assert ACTION_PARAMETER_KEYS["sequence_insights"] == {
        "sequence_upload_id", "operation", "motif", "min_aa",
    }


def test_planned_capabilities_are_not_accidentally_executable():
    planned = [capability for capability in all_capabilities() if capability.status == "planned"]
    assert planned
    assert all(capability.action_type is None for capability in planned)


def test_domain_lookup_is_bounded():
    protein_capabilities = capabilities_by_domain("proteins_proteomics")
    assert any(capability.capability_id == "protein_properties" for capability in protein_capabilities)

    with pytest.raises(ValueError):
        capabilities_by_domain("not_a_domain")


def test_capability_lookup_rejects_unknown_id():
    assert get_capability("blast").status == "available"

    with pytest.raises(ValueError):
        get_capability("unknown_capability")


def test_gwas_local_execution_is_not_an_unapproved_server_side_job():
    gwas = get_capability("gwas")
    assert gwas.status == "available"
    assert gwas.execution_kind == "local"
    assert gwas.action_type is None
    assert "gwas" not in executable_action_types()
