from __future__ import annotations

import hashlib
import json
import re
import time
from dataclasses import dataclass
from typing import Any
from urllib.error import HTTPError, URLError
from urllib.parse import urlencode, quote
from urllib.request import Request, urlopen

CONNECTOR_VERSION = "genithm-protein-annotation-connector/0.1.0"
UNIPROT_BASE = "https://rest.uniprot.org"
INTERPRO_BASE = "https://www.ebi.ac.uk/interpro/api"
MAX_MAPPING_BYTES = 10 * 1024 * 1024
MAX_UNIPROT_BYTES = 10 * 1024 * 1024
MAX_INTERPRO_BYTES = 20 * 1024 * 1024
MAX_PAGES = 5
PAGE_SIZE = 200
ACCESSION_RE = re.compile(r"^[A-Z0-9_]+(?:\.[0-9]+)?$")
UNIPROT_RE = re.compile(r"^[A-Z0-9-]{6,20}$")


class ProteinAnnotationError(ValueError):
    pass


class ProteinAnnotationTransientError(RuntimeError):
    pass


@dataclass(frozen=True, slots=True)
class SourcePayload:
    raw: bytes
    sha256: str
    byte_count: int
    headers: dict[str, str]


@dataclass(frozen=True, slots=True)
class UniProtRecord:
    accession: str
    entry_id: str
    reviewed: bool
    release: str | None
    release_date: str | None
    sequence: str
    sequence_sha256: str
    protein_name: str | None
    gene_names: list[str]
    organism_name: str | None
    payload: SourcePayload


@dataclass(frozen=True, slots=True)
class AnnotationEvidence:
    mapping_candidate_count: int
    mapping_payload: SourcePayload
    uniprot: UniProtRecord
    interpro_entries: list[dict[str, Any]]
    interpro_payload: SourcePayload
    pfam_entries: list[dict[str, Any]]
    pfam_payload: SourcePayload


def _payload(raw: bytes, headers: Any) -> SourcePayload:
    return SourcePayload(raw, hashlib.sha256(raw).hexdigest(), len(raw), {str(k).lower(): str(v) for k, v in headers.items()})


def _json(payload: SourcePayload, label: str) -> Any:
    try:
        return json.loads(payload.raw.decode("utf-8"))
    except (UnicodeDecodeError, json.JSONDecodeError) as exc:
        raise ProteinAnnotationError(f"{label} returned invalid JSON") from exc


def _read_json(request: Request, max_bytes: int, label: str, timeout: int = 30) -> SourcePayload:
    try:
        with urlopen(request, timeout=timeout) as response:
            raw = response.read(max_bytes + 1)
            if len(raw) > max_bytes:
                raise ProteinAnnotationError(f"{label} response exceeds Genithm size limit")
            if not raw:
                raise ProteinAnnotationError(f"{label} returned an empty response")
            return _payload(raw, response.headers)
    except HTTPError as exc:
        if exc.code in {408, 425, 429, 500, 502, 503, 504}:
            raise ProteinAnnotationTransientError(f"{label} temporarily unavailable (HTTP {exc.code})") from exc
        raise ProteinAnnotationError(f"{label} request failed (HTTP {exc.code})") from exc
    except URLError as exc:
        raise ProteinAnnotationTransientError(f"{label} connection failed") from exc


def parse_single_protein_fasta(raw: bytes) -> str:
    if not raw or len(raw) > 2 * 1024 * 1024:
        raise ProteinAnnotationError("protein input is outside the worker read limit")
    try:
        text = raw.decode("ascii")
    except UnicodeDecodeError as exc:
        raise ProteinAnnotationError("protein FASTA must be ASCII") from exc
    records: list[list[str]] = []
    current: list[str] | None = None
    for source_line in text.splitlines():
        line = source_line.strip()
        if not line:
            continue
        if line.startswith(">"):
            current = []
            records.append(current)
        else:
            if current is None:
                raise ProteinAnnotationError("protein FASTA is missing a header")
            current.append("".join(line.split()).upper())
    if len(records) != 1:
        raise ProteinAnnotationError("protein annotation requires exactly one FASTA record")
    sequence = "".join(records[0])
    if not sequence or not sequence.isalpha():
        raise ProteinAnnotationError("protein FASTA contains unsupported symbols")
    return sequence


def _candidate_accessions(data: Any) -> list[str]:
    if not isinstance(data, dict):
        raise ProteinAnnotationError("UniProt mapping response has an invalid shape")
    results = data.get("results")
    if not isinstance(results, list):
        return []
    accessions: list[str] = []
    for item in results:
        if not isinstance(item, dict):
            continue
        target = item.get("to")
        accession: str | None = None
        if isinstance(target, str):
            accession = target
        elif isinstance(target, dict):
            candidate = target.get("primaryAccession") or target.get("uniProtkbId")
            if isinstance(candidate, str):
                accession = candidate
        if accession and UNIPROT_RE.fullmatch(accession) and accession not in accessions:
            accessions.append(accession)
    return accessions[:100]


def _protein_name(record: dict[str, Any]) -> str | None:
    desc = record.get("proteinDescription")
    if not isinstance(desc, dict):
        return None
    recommended = desc.get("recommendedName")
    if isinstance(recommended, dict):
        full = recommended.get("fullName")
        if isinstance(full, dict) and isinstance(full.get("value"), str):
            return full["value"][:1000]
    submitted = desc.get("submissionNames")
    if isinstance(submitted, list) and submitted:
        first = submitted[0]
        if isinstance(first, dict):
            full = first.get("fullName")
            if isinstance(full, dict) and isinstance(full.get("value"), str):
                return full["value"][:1000]
    return None


def _gene_names(record: dict[str, Any]) -> list[str]:
    output: list[str] = []
    genes = record.get("genes")
    if not isinstance(genes, list):
        return output
    for gene in genes:
        if not isinstance(gene, dict):
            continue
        for key in ("geneName", "synonyms", "orfNames", "orderedLocusNames"):
            value = gene.get(key)
            values = value if isinstance(value, list) else [value]
            for item in values:
                if isinstance(item, dict) and isinstance(item.get("value"), str):
                    name = item["value"].strip()
                    if name and name not in output:
                        output.append(name[:128])
                        if len(output) >= 100:
                            return output
    return output


def parse_uniprot_record(payload: SourcePayload, expected_accession: str) -> UniProtRecord:
    data = _json(payload, "UniProtKB")
    if not isinstance(data, dict):
        raise ProteinAnnotationError("UniProtKB response has an invalid shape")
    accession = data.get("primaryAccession")
    entry_id = data.get("uniProtkbId")
    sequence_obj = data.get("sequence")
    if accession != expected_accession or not isinstance(entry_id, str) or not isinstance(sequence_obj, dict):
        raise ProteinAnnotationError("UniProtKB record identity is invalid")
    sequence = sequence_obj.get("value")
    if not isinstance(sequence, str) or not sequence or not sequence.isalpha():
        raise ProteinAnnotationError("UniProtKB sequence is invalid")
    sequence = sequence.upper()
    entry_type = data.get("entryType")
    reviewed = isinstance(entry_type, str) and "reviewed" in entry_type.lower() and "unreviewed" not in entry_type.lower()
    organism = data.get("organism")
    organism_name = organism.get("scientificName") if isinstance(organism, dict) and isinstance(organism.get("scientificName"), str) else None
    return UniProtRecord(
        accession=accession,
        entry_id=entry_id[:64],
        reviewed=reviewed,
        release=payload.headers.get("x-uniprot-release"),
        release_date=payload.headers.get("x-uniprot-release-date"),
        sequence=sequence,
        sequence_sha256=hashlib.sha256(sequence.encode("ascii")).hexdigest(),
        protein_name=_protein_name(data),
        gene_names=_gene_names(data),
        organism_name=organism_name[:1000] if organism_name else None,
        payload=payload,
    )


def normalize_interpro_results(data: Any, source_database: str) -> list[dict[str, Any]]:
    if not isinstance(data, dict) or not isinstance(data.get("results"), list):
        raise ProteinAnnotationError(f"{source_database} response has an invalid shape")
    normalized: list[dict[str, Any]] = []
    for result in data["results"]:
        if not isinstance(result, dict):
            continue
        metadata = result.get("metadata")
        if not isinstance(metadata, dict):
            continue
        accession = metadata.get("accession")
        if not isinstance(accession, str) or not accession:
            continue
        entry: dict[str, Any] = {
            "accession": accession[:64],
            "name": str(metadata.get("name") or "")[:1000] or None,
            "type": str(metadata.get("type") or "")[:128] or None,
            "source_database": source_database,
            "locations": [],
        }
        proteins = result.get("proteins")
        if isinstance(proteins, list):
            for protein in proteins[:20]:
                if not isinstance(protein, dict):
                    continue
                locations = protein.get("entry_protein_locations")
                if not isinstance(locations, list):
                    continue
                for location in locations[:100]:
                    if not isinstance(location, dict):
                        continue
                    fragments = location.get("fragments")
                    if not isinstance(fragments, list):
                        continue
                    for fragment in fragments[:20]:
                        if not isinstance(fragment, dict):
                            continue
                        start = fragment.get("start")
                        end = fragment.get("end")
                        if isinstance(start, int) and isinstance(end, int) and 1 <= start <= end:
                            entry["locations"].append({"start": start, "end": end})
                            if len(entry["locations"]) >= 200:
                                break
        normalized.append(entry)
        if len(normalized) >= 1000:
            break
    return normalized


class ProteinAnnotationConnector:
    def __init__(self, user_agent: str = CONNECTOR_VERSION, poll_seconds: float = 1.0, max_mapping_polls: int = 20) -> None:
        self.user_agent = user_agent
        self.poll_seconds = poll_seconds
        self.max_mapping_polls = max_mapping_polls

    def _headers(self, *, json_accept: bool = True, content_type: str | None = None) -> dict[str, str]:
        headers = {"User-Agent": self.user_agent}
        if json_accept:
            headers["Accept"] = "application/json"
        if content_type:
            headers["Content-Type"] = content_type
        return headers

    def map_refseq_to_uniprot(self, refseq_accession: str) -> tuple[list[str], SourcePayload]:
        accession = refseq_accession.strip().upper()
        if not ACCESSION_RE.fullmatch(accession):
            raise ProteinAnnotationError("RefSeq protein accession is invalid")
        body = urlencode({"from": "RefSeq_Protein", "to": "UniProtKB", "ids": accession}).encode("ascii")
        run_payload = _read_json(Request(f"{UNIPROT_BASE}/idmapping/run", data=body, headers=self._headers(content_type="application/x-www-form-urlencoded"), method="POST"), MAX_MAPPING_BYTES, "UniProt ID mapping submission")
        run_data = _json(run_payload, "UniProt ID mapping submission")
        if not isinstance(run_data, dict) or not isinstance(run_data.get("jobId"), str):
            raise ProteinAnnotationError("UniProt ID mapping did not return a job identifier")
        job_id = run_data["jobId"]
        if not re.fullmatch(r"[A-Za-z0-9_-]{1,128}", job_id):
            raise ProteinAnnotationError("UniProt ID mapping job identifier is invalid")
        final_status: SourcePayload | None = None
        for _ in range(self.max_mapping_polls):
            status = _read_json(Request(f"{UNIPROT_BASE}/idmapping/status/{quote(job_id, safe='')}", headers=self._headers(), method="GET"), MAX_MAPPING_BYTES, "UniProt ID mapping status")
            status_data = _json(status, "UniProt ID mapping status")
            if isinstance(status_data, dict) and status_data.get("jobStatus") in {"RUNNING", "NEW"}:
                time.sleep(self.poll_seconds)
                continue
            final_status = status
            break
        if final_status is None:
            raise ProteinAnnotationTransientError("UniProt ID mapping did not complete within the polling limit")
        results_payload = _read_json(Request(f"{UNIPROT_BASE}/idmapping/uniprotkb/results/{quote(job_id, safe='')}?format=json&size=100", headers=self._headers(), method="GET"), MAX_MAPPING_BYTES, "UniProt ID mapping results")
        return _candidate_accessions(_json(results_payload, "UniProt ID mapping results")), results_payload

    def fetch_uniprot(self, accession: str) -> UniProtRecord:
        if not UNIPROT_RE.fullmatch(accession):
            raise ProteinAnnotationError("mapped UniProt accession is invalid")
        payload = _read_json(Request(f"{UNIPROT_BASE}/uniprotkb/{quote(accession, safe='')}.json", headers=self._headers(), method="GET"), MAX_UNIPROT_BYTES, "UniProtKB")
        return parse_uniprot_record(payload, accession)

    def _fetch_interpro_family(self, accession: str, family: str) -> tuple[list[dict[str, Any]], SourcePayload]:
        if family not in {"interpro", "pfam"}:
            raise ProteinAnnotationError("unsupported InterPro source family")
        raw_pages: list[bytes] = []
        headers: dict[str, str] = {}
        entries: list[dict[str, Any]] = []
        for page in range(1, MAX_PAGES + 1):
            url = f"{INTERPRO_BASE}/entry/{family}/protein/uniprot/{quote(accession, safe='')}/?page_size={PAGE_SIZE}&page={page}"
            payload = _read_json(Request(url, headers=self._headers(), method="GET"), MAX_INTERPRO_BYTES, f"InterPro {family}")
            raw_pages.append(payload.raw)
            if not headers:
                headers = payload.headers
            data = _json(payload, f"InterPro {family}")
            page_entries = normalize_interpro_results(data, family)
            entries.extend(page_entries)
            count = data.get("count") if isinstance(data, dict) else None
            if not isinstance(count, int) or len(entries) >= count or len(page_entries) < PAGE_SIZE:
                break
            if len(entries) >= 1000:
                break
        combined = b"\n".join(raw_pages)
        if len(combined) > MAX_INTERPRO_BYTES:
            raise ProteinAnnotationError(f"InterPro {family} combined response exceeds Genithm size limit")
        return entries[:1000], SourcePayload(combined, hashlib.sha256(combined).hexdigest(), len(combined), headers)

    def annotate(self, refseq_accession: str, expected_sequence: str) -> AnnotationEvidence | None:
        candidates, mapping_payload = self.map_refseq_to_uniprot(refseq_accession)
        if not candidates:
            return None
        matching: list[UniProtRecord] = []
        for accession in candidates:
            record = self.fetch_uniprot(accession)
            if record.sequence == expected_sequence:
                matching.append(record)
        if not matching:
            raise ProteinAnnotationError("No mapped UniProtKB candidate exactly matches the immutable Genithm protein sequence")
        matching.sort(key=lambda item: (not item.reviewed, item.accession))
        selected = matching[0]
        interpro_entries, interpro_payload = self._fetch_interpro_family(selected.accession, "interpro")
        pfam_entries, pfam_payload = self._fetch_interpro_family(selected.accession, "pfam")
        return AnnotationEvidence(len(candidates), mapping_payload, selected, interpro_entries, interpro_payload, pfam_entries, pfam_payload)
