from __future__ import annotations

import argparse
import hashlib
import json
import logging
import os
import time
from typing import Any

from .msa import MsaError
from .pairwise import PairwiseAlignmentError
from .phylogeny import PhylogenyError
from .protein import (
    EXECUTOR_VERSION as PROTEIN_EXECUTOR_VERSION,
    TOOL_ID as PROTEIN_TOOL_ID,
    TOOL_VERSION as PROTEIN_TOOL_VERSION,
    ProteinPropertiesError,
    calculate_protein_properties,
    parse_single_protein_fasta,
)
from .runtime import (
    Client as BaseClient,
    Config,
    process_msa,
    process_pairwise,
    process_phylogeny,
)

LOGGER = logging.getLogger("genithm.scientific-worker")
WORKER_VERSION = "genithm-scientific-worker/0.4.0"


class Client(BaseClient):
    def _headers(self, content_type: str | None = None) -> dict[str, str]:
        headers = {
            "apikey": self.config.supabase_secret_key,
            "Authorization": f"Bearer {self.config.supabase_secret_key}",
            "User-Agent": WORKER_VERSION,
        }
        if content_type:
            headers["Content-Type"] = content_type
        return headers


def canonical_protein_result(job: dict[str, Any], sequence: str) -> tuple[bytes, dict[str, Any], dict[str, Any]]:
    inputs = job.get("inputs")
    if not isinstance(inputs, list) or len(inputs) != 1:
        raise ProteinPropertiesError("protein properties job input provenance is invalid")
    props = calculate_protein_properties(sequence)
    input_sha = str(inputs[0]["sha256"])
    summary: dict[str, Any] = {
        "job_type": "protein_properties",
        "alphabet": "canonical_20_amino_acids",
        "length": props.length,
        "amino_acid_composition": props.amino_acid_composition,
        "molecular_weight_da": props.molecular_weight_da,
        "aromaticity_fraction": props.aromaticity_fraction,
        "gravy": props.gravy,
        "estimated_net_charge_ph7": props.estimated_net_charge_ph7,
        "estimated_isoelectric_point": props.estimated_isoelectric_point,
        "input_sha256": input_sha,
    }
    provenance: dict[str, Any] = {
        "tool_id": PROTEIN_TOOL_ID,
        "tool_version": PROTEIN_TOOL_VERSION,
        "executor_version": PROTEIN_EXECUTOR_VERSION,
        "request_fingerprint": str(job["request_fingerprint"]),
        "input_sha256": input_sha,
        "parameters": job["parameters"],
        "calculation_methods": {
            "molecular_weight": "average_residue_mass_plus_water",
            "hydropathy": "kyte_doolittle",
            "charge": "henderson_hasselbalch_v1",
            "isoelectric_point": "bisection_zero_charge_0_to_14",
        },
        "scientific_limitations": [
            "Canonical 20-amino-acid sequences only.",
            "Charge and isoelectric point are deterministic estimates, not experimental measurements.",
            "No post-translational modifications, disulfide state, cofactors, or terminal modifications are modeled.",
        ],
    }
    artifact = {
        "schema_version": "genithm-protein-properties-result/1",
        "summary": summary,
        "provenance": provenance,
    }
    data = json.dumps(artifact, sort_keys=True, separators=(",", ":"), ensure_ascii=True).encode("utf-8")
    return data, summary, provenance


def process_protein(client: Client, job: dict[str, Any]) -> tuple[bytes, dict[str, Any], dict[str, Any], str, str, str]:
    if job["tool_id"] != PROTEIN_TOOL_ID or job["tool_version"] != PROTEIN_TOOL_VERSION:
        raise ProteinPropertiesError("claimed job does not match approved protein properties executor")
    inputs = job.get("inputs")
    if not isinstance(inputs, list) or len(inputs) != 1:
        raise ProteinPropertiesError("protein properties require exactly one scientific input")
    item = inputs[0]
    if str(item.get("sequence_type", "")) != "protein":
        raise ProteinPropertiesError("protein properties require a validated protein input")
    raw = client.download(str(item["object_path"]), int(item["file_size_bytes"]), str(item["sha256"]))
    sequence = parse_single_protein_fasta(raw)
    if len(sequence) != int(item["residue_count"]):
        raise ProteinPropertiesError("protein residue count does not match validated input provenance")
    data, summary, provenance = canonical_protein_result(job, sequence)
    path = f"{job['organization_id']}/{job['project_id']}/{job['job_id']}/protein-properties.json"
    return data, summary, provenance, path, "application/json", PROTEIN_EXECUTOR_VERSION


def process_one(client: Client) -> bool:
    rows = client.rpc("claim_scientific_job", {"visibility_seconds": client.config.visibility_seconds})
    if not rows:
        return False
    job = rows[0]
    message_id = int(job["message_id"])
    job_id = str(job["job_id"])
    try:
        if job["job_type"] == "pairwise_alignment":
            data, summary, provenance, path, content_type, executor_version = process_pairwise(client, job)
            success_rpc = "finish_scientific_job_success"
        elif job["job_type"] == "multiple_sequence_alignment":
            data, summary, provenance, path, content_type, executor_version = process_msa(client, job)
            success_rpc = "finish_scientific_job_success"
        elif job["job_type"] == "phylogenetic_tree":
            data, summary, provenance, path, content_type, executor_version = process_phylogeny(client, job)
            success_rpc = "finish_phylogenetic_job_success"
        elif job["job_type"] == "protein_properties":
            data, summary, provenance, path, content_type, executor_version = process_protein(client, job)
            success_rpc = "finish_protein_properties_success"
        else:
            raise ValueError("claimed scientific job type is not supported by this worker")

        client.upload_result(path, data, content_type)
        client.rpc(success_rpc, {
            "message_id": message_id,
            "job_id": job_id,
            "executor_version": executor_version,
            "result_object_path": path,
            "result_sha256": hashlib.sha256(data).hexdigest(),
            "result_bytes": len(data),
            "result_summary": summary,
            "provenance": provenance,
        })
        LOGGER.info("scientific job completed job_id=%s type=%s", job_id, job["job_type"])
    except (PairwiseAlignmentError, MsaError, PhylogenyError, ProteinPropertiesError, ValueError) as exc:
        client.rpc("finish_scientific_job_error", {
            "message_id": message_id,
            "job_id": job_id,
            "failure_class": "output_validation" if isinstance(exc, (MsaError, PhylogenyError)) else "input_integrity",
            "processing_error": str(exc)[:2000],
            "retryable": False,
            "max_attempts": client.config.max_attempts,
        })
    except Exception as exc:
        client.rpc("finish_scientific_job_error", {
            "message_id": message_id,
            "job_id": job_id,
            "failure_class": "infrastructure",
            "processing_error": f"{type(exc).__name__}: scientific worker failed"[:2000],
            "retryable": True,
            "max_attempts": client.config.max_attempts,
        })
        LOGGER.error("scientific job failed job_id=%s error_type=%s", job_id, type(exc).__name__)
    return True


def main() -> int:
    parser = argparse.ArgumentParser(description="Genithm isolated scientific execution worker")
    parser.add_argument("--once", action="store_true", help="Process at most one scientific job and exit")
    args = parser.parse_args()
    logging.basicConfig(level=os.environ.get("LOG_LEVEL", "INFO"), format="%(asctime)s %(levelname)s %(message)s")
    config = Config.from_env()
    client = Client(config)
    if args.once:
        process_one(client)
        return 0
    while True:
        if not process_one(client):
            time.sleep(config.poll_seconds)


if __name__ == "__main__":
    raise SystemExit(main())
