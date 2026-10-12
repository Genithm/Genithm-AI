from __future__ import annotations

"""Independent scientific artifact verification (no Supabase / no network).

The auditor checks integrity and internally-consistent scientific claims,
but cannot independently prove *input* authenticity without trusted input hashes.
"""
import argparse
import hashlib
import json
import math
import re
from pathlib import Path
from typing import Any

SHA = re.compile(r"[a-f0-9]{64}\Z")
MAX_ARTIFACT_BYTES = 25 * 1024 * 1024
JSON_JOB_TYPES = frozenset({"pairwise_alignment", "sequence_insights", "protein_properties"})
TOOL_IDS = {
    "pairwise_alignment": "genithm-pairwise-aligner",
    "sequence_insights": "genithm-sequence-insights",
    "protein_properties": "genithm-protein-properties",
}


class ScientificArtifactAuditError(ValueError):
    pass


def require(condition: bool, message: str) -> None:
    if not condition:
        raise ScientificArtifactAuditError(message)


def _integer(value: object, *, minimum: int = 0) -> bool:
    return type(value) is int and value >= minimum


def _finite(value: object) -> bool:
    return type(value) in (int, float) and math.isfinite(value)


def _sha(value: object) -> bool:
    return isinstance(value, str) and SHA.fullmatch(value) is not None


def _pairwise(summary: dict[str, Any], artifact: dict[str, Any], provenance: dict[str, Any]) -> None:
    alignment = artifact.get("alignment")
    params = provenance.get("parameters")
    require(isinstance(alignment, dict) and set(alignment) == {"sequence_a", "sequence_b"},
            "pairwise alignment payload is incomplete")
    require(isinstance(params, dict), "pairwise score parameters are missing")
    for field in ("match_score", "mismatch_score", "gap_score"):
        require(type(params.get(field)) is int, f"invalid pairwise {field}")
    a, b = alignment["sequence_a"], alignment["sequence_b"]
    require(isinstance(a, str) and isinstance(b, str) and len(a) == len(b) <= 20000,
            "pairwise alignment columns are invalid")
    require(all(not (x == y == "-") for x, y in zip(a, b)),
            "pairwise alignment contains double-gap columns")
    require(all(c in "ACGTUNBXZJUO*DEFGHIKLMPQRSVWY-" for c in a+b),
            "pairwise alignment contains unsupported residue characters")
    matches = sum(x == y and x != "-" for x,y in zip(a,b))
    gaps = sum("-" in (x,y) for x,y in zip(a,b))
    mismatches = len(a) - matches - gaps
    score = (matches*params["match_score"] +
             mismatches*params["mismatch_score"] + gaps*params["gap_score"])
    for field, actual in (
        ("aligned_length",len(a)),("matches",matches),
        ("mismatches",mismatches),("gaps",gaps),("score",score)
    ):
        require(_integer(summary.get(field)) if field != "score" else type(summary.get(field)) is int,
                f"invalid pairwise {field} type")
        require(summary[field] == actual, f"pairwise {field} does not match alignment evidence")
    expected_identity = round(100*matches/len(a),6) if a else 0.
    require(_finite(summary.get("identity_percent")) and
            abs(summary["identity_percent"]-expected_identity) < 0.000001,
            "pairwise identity is inconsistent with aligned columns")
    require(summary.get("algorithm") in {"global","local"} and
            summary["algorithm"] == params.get("algorithm"), "pairwise algorithm provenance mismatch")
    require(_sha(summary.get("input_a_sha256")) and _sha(summary.get("input_b_sha256")),
            "pairwise input hashes are missing")


def _sequence_insights(summary: dict[str, Any], artifact: dict[str, Any], provenance: dict[str, Any]) -> None:
    output = artifact.get("result")
    require(isinstance(output, dict), "sequence insight result is missing")
    operation = summary.get("operation")
    require(operation in {"orf_scan","six_frame_translation","motif_scan","reverse_complement"},
            "sequence insight operation is not approved")
    require(output.get("operation") == operation and
            summary.get("sequence_type") in {"dna","rna"} and
            _integer(summary.get("sequence_length"),minimum=1),
            "sequence insight summary does not match operation")
    length = summary["sequence_length"]
    if operation == "orf_scan":
        orfs=output.get("orfs")
        require(isinstance(orfs,list) and len(orfs)<=100 and
                _integer(summary.get("orf_count")) and
                summary["orf_count"]>=len(orfs) and
                summary.get("reported_orfs")==len(orfs), "ORF count is invalid")
        for orf in orfs:
            require(isinstance(orf,dict) and
                    all(_integer(orf.get(key),minimum=1) for key in
                        ("start_1based","end_1based","amino_acids")) and
                    orf["start_1based"]<=orf["end_1based"]<=length and
                    (orf["end_1based"]-orf["start_1based"]+1)==3*(orf["amino_acids"]+1) and
                    orf.get("strand") in ("+","-") and
                    isinstance(orf.get("protein"),str) and
                    len(orf["protein"])==orf["amino_acids"],
                    "ORF evidence has invalid coordinates or peptide length")
    elif operation == "six_frame_translation":
        frames=output.get("frames")
        require(isinstance(frames,list) and len(frames)==6 and summary.get("frame_count")==6,
                "six-frame result must contain exactly six translations")
        expected={(strand, frame) for strand in ("+","-") for frame in (1,2,3)}
        observed=set()
        for frame in frames:
            require(isinstance(frame,dict) and isinstance(frame.get("protein"),str)
                    and len(frame["protein"]) <= length//3 and
                    (frame.get("strand"),frame.get("frame")) in expected,
                    "six-frame translation evidence is malformed")
            observed.add((frame["strand"],frame["frame"]))
        require(observed==expected, "six-frame translations must cover unique reading frames")
    elif operation == "motif_scan":
        hits=output.get("hits")
        motif=summary.get("motif")
        require(isinstance(hits,list) and len(hits)<=1000 and
                isinstance(motif,str) and 2<=len(motif)<=32 and
                _integer(summary.get("motif_hits")) and
                summary["motif_hits"]>=len(hits) and
                summary.get("reported_hits")==len(hits),
                "motif result counts are inconsistent")
        for hit in hits:
            require(isinstance(hit,dict) and
                    _integer(hit.get("start_1based"),minimum=1) and
                    _integer(hit.get("end_1based"),minimum=1) and
                    hit["end_1based"]-hit["start_1based"]+1 == len(motif) and
                    hit["end_1based"]<=length and hit.get("strand") in ("+","-"),
                    "motif hit coordinates are invalid")
    elif operation == "reverse_complement":
        out=output.get("reverse_complement")
        require(isinstance(out,str) and len(out)==length and
                summary.get("output_length")==length and
                set(out) <= set("ACGTN" if summary["sequence_type"]=="dna" else "ACGUN"),
                "reverse complement evidence length/alphabet is invalid")
    require(_sha(summary.get("input_sha256")), "sequence insight input hash is missing")


def _protein(summary: dict[str, Any], artifact: dict[str, Any], provenance: dict[str, Any]) -> None:
    n=summary.get("length")
    comp=summary.get("amino_acid_composition")
    require(_integer(n,minimum=1) and isinstance(comp,dict) and
            all(_integer(value) for value in comp.values()) and
            sum(comp.values())==n,"protein composition does not match sequence length")
    require(_sha(summary.get("input_sha256")),"protein input hash is missing")
    for key in ("molecular_weight_da","aromaticity_fraction","gravy",
                "estimated_net_charge_ph7","estimated_isoelectric_point"):
        require(_finite(summary.get(key)),f"protein physicochemical measure {key} is not finite")
    require(summary["molecular_weight_da"]>0 and
            0<=summary["aromaticity_fraction"]<=1 and
            0<=summary["estimated_isoelectric_point"]<=14,
            "protein physicochemical measures exceed known bounds")


def audit_json_artifact(
    data: bytes, *, claimed_sha256: str | None = None,
    expected_job_type: str | None = None,
    expected_summary: dict[str,Any] | None = None,
    expected_provenance: dict[str,Any] | None = None,
) -> dict[str, Any]:
    require(isinstance(data,bytes) and 1 <= len(data) <= MAX_ARTIFACT_BYTES,
            "scientific evidence exceeds JSON size bounds")
    digest=hashlib.sha256(data).hexdigest()
    if claimed_sha256 is not None:
        require(_sha(claimed_sha256) and digest==claimed_sha256,
                "scientific evidence SHA-256 mismatch")
    try:
        artifact=json.loads(data.decode("utf-8"), parse_constant=lambda value: (_ for _ in ()).throw(ScientificArtifactAuditError("non-finite numeric values are not permitted")))
    except (UnicodeError,json.JSONDecodeError) as exc:
        raise ScientificArtifactAuditError("scientific evidence is not valid JSON") from exc
    require(isinstance(artifact,dict) and
            isinstance(artifact.get("summary"),dict) and
            isinstance(artifact.get("provenance"),dict),
            "scientific evidence does not include a summary and provenance")
    require(json.dumps(artifact,sort_keys=True,separators=(",",":"),ensure_ascii=True,allow_nan=False).encode("utf-8")==data,
            "scientific evidence is not canonical deterministic JSON")
    summary=artifact["summary"]
    provenance=artifact["provenance"]
    job_type=summary.get("job_type")
    require(isinstance(job_type,str) and job_type in JSON_JOB_TYPES,
            "unrecognized scientific evidence type")
    if expected_job_type is not None:
        require(expected_job_type==job_type, "scientific evidence job type mismatch")
    require(provenance.get("tool_id")==TOOL_IDS[job_type] and
            isinstance(provenance.get("tool_version"),str) and provenance["tool_version"] and
            isinstance(provenance.get("executor_version"),str) and provenance["executor_version"] and
            _sha(provenance.get("request_fingerprint")),
            "scientific evidence tool provenance is invalid")
    if expected_summary is not None:
        require(summary == expected_summary, "scientific result differs from queued job summary")
    if expected_provenance is not None:
        require(provenance == expected_provenance, "scientific result differs from queued job provenance")
    if job_type=="pairwise_alignment":
        _pairwise(summary,artifact,provenance)
    elif job_type=="sequence_insights":
        _sequence_insights(summary,artifact,provenance)
    else:
        _protein(summary,artifact,provenance)
    return {"verified":True,"job_type":job_type,"sha256":digest,"bytes":len(data),
            "tool_id":provenance["tool_id"],"tool_version":provenance["tool_version"]}


def main() -> int:
    parser=argparse.ArgumentParser(description="Offline verification of canonical Genithm scientific JSON artifacts")
    parser.add_argument("artifact",type=Path)
    parser.add_argument("--sha256",default=None,help="Independent trusted artifact digest")
    parser.add_argument("--job-type",choices=sorted(JSON_JOB_TYPES),default=None)
    arguments=parser.parse_args()
    try:
        if arguments.artifact.stat().st_size > MAX_ARTIFACT_BYTES:
            raise ScientificArtifactAuditError("scientific evidence exceeds JSON size bounds")
        data=arguments.artifact.read_bytes()
        result=audit_json_artifact(data,claimed_sha256=arguments.sha256,
                                   expected_job_type=arguments.job_type)
        print(json.dumps(result,sort_keys=True))
        return 0
    except (OSError,ScientificArtifactAuditError) as exc:
        print(json.dumps({"verified":False,"error":str(exc)}))
        return 2


if __name__=="__main__":
    raise SystemExit(main())
