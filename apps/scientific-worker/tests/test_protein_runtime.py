from __future__ import annotations

import hashlib
import json

from genithm_scientific_worker.runtime_v4 import canonical_protein_result


def test_canonical_protein_result_is_stable_and_omits_raw_sequence() -> None:
    job = {
        "parameters": {
            "alphabet": "canonical_20_amino_acids",
            "mass_method": "average_residue_mass_plus_water",
            "hydropathy_scale": "kyte_doolittle",
            "charge_model": "henderson_hasselbalch_v1",
        },
        "request_fingerprint": "f" * 64,
        "inputs": [{"sha256": "a" * 64}],
    }
    data, summary, provenance = canonical_protein_result(job, "ACDEFGHIKLMNPQRSTVWY")
    artifact = json.loads(data)
    assert artifact["schema_version"] == "genithm-protein-properties-result/1"
    assert artifact["summary"] == summary
    assert artifact["provenance"] == provenance
    assert summary["input_sha256"] == "a" * 64
    assert summary["length"] == 20
    assert provenance["tool_id"] == "genithm-protein-properties"
    assert provenance["tool_version"] == "0.1.0"
    assert provenance["executor_version"] == "genithm-scientific-worker/0.4.0"
    assert b"ACDEFGHIKLMNPQRSTVWY" not in data
    assert len(hashlib.sha256(data).hexdigest()) == 64
