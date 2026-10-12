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


def test_available_capabilities_are_mapped_to_actions():
    assert available_capabilities()
    assert all(capability.action_type for capability in available_capabilities())


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
