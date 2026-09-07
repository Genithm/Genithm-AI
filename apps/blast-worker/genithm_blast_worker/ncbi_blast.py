from __future__ import annotations

import re
import time
import xml.etree.ElementTree as ET
from dataclasses import dataclass
from typing import Any
from urllib.error import HTTPError, URLError
from urllib.parse import urlencode
from urllib.request import Request, urlopen

SERVICE_VERSION = "genithm-ncbi-blast-url-api/0.1.0"
BLAST_URL = "https://blast.ncbi.nlm.nih.gov/Blast.cgi"
MAX_RESULT_BYTES = 25 * 1024 * 1024


class BlastRemoteError(RuntimeError):
    pass


class BlastResultError(ValueError):
    pass


@dataclass(frozen=True, slots=True)
class BlastSubmission:
    rid: str
    rtoe_seconds: int


@dataclass(frozen=True, slots=True)
class BlastResult:
    raw_xml: bytes
    blast_version: str
    database_reported: str
    database_release: str | None
    summary: dict[str, Any]
    hits: list[dict[str, Any]]


def _first_text(root: ET.Element, names: tuple[str, ...]) -> str:
    for elem in root.iter():
        local = elem.tag.rsplit("}", 1)[-1]
        if local in names and elem.text:
            value = elem.text.strip()
            if value:
                return value
    return ""


def _child_text(node: ET.Element, names: tuple[str, ...]) -> str:
    for elem in node.iter():
        local = elem.tag.rsplit("}", 1)[-1]
        if local in names and elem.text:
            value = elem.text.strip()
            if value:
                return value
    return ""


def parse_search_info(data: bytes) -> str:
    text = data.decode("utf-8", errors="replace")
    match = re.search(r"Status=(WAITING|READY|FAILED|UNKNOWN)", text)
    if not match:
        raise BlastRemoteError("NCBI BLAST search status response was malformed")
    return match.group(1)


def parse_submission(data: bytes) -> BlastSubmission:
    text = data.decode("utf-8", errors="replace")
    rid_match = re.search(r"RID\s*=\s*([A-Za-z0-9_-]{5,128})", text)
    rtoe_match = re.search(r"RTOE\s*=\s*(\d+)", text)
    if not rid_match or not rtoe_match:
        raise BlastRemoteError("NCBI BLAST submission did not return RID/RTOE")
    rtoe = int(rtoe_match.group(1))
    if not 0 <= rtoe <= 21600:
        raise BlastRemoteError("NCBI BLAST returned an invalid RTOE")
    return BlastSubmission(rid=rid_match.group(1), rtoe_seconds=rtoe)


def parse_xml2(data: bytes, *, query_sha256: str, max_targets: int) -> BlastResult:
    if not data or len(data) > MAX_RESULT_BYTES:
        raise BlastResultError("BLAST XML result is empty or too large")
    try:
        root = ET.fromstring(data)
    except ET.ParseError as exc:
        raise BlastResultError("BLAST returned malformed XML") from exc

    blast_version = _first_text(root, ("version", "BlastOutput_version"))
    database = _first_text(root, ("db", "BlastOutput_db"))
    db_release = _first_text(root, ("db-version", "db_release", "database-release")) or None
    query_len_text = _first_text(root, ("query-len", "BlastOutput_query-len", "Iteration_query-len"))
    try:
        query_len = int(query_len_text)
    except ValueError as exc:
        raise BlastResultError("BLAST result is missing query length") from exc
    if query_len <= 0 or not blast_version or not database:
        raise BlastResultError("BLAST result provenance is incomplete")

    hits: list[dict[str, Any]] = []
    for hit in [e for e in root.iter() if e.tag.rsplit("}", 1)[-1] in {"Hit", "hit"}]:
        if len(hits) >= max_targets:
            break
        subject_id = _child_text(hit, ("id", "Hit_id"))
        title = _child_text(hit, ("title", "Hit_def"))
        hsps = [e for e in hit.iter() if e.tag.rsplit("}", 1)[-1] in {"Hsp", "hsp"}]
        if not subject_id or not hsps:
            continue
        hsp = hsps[0]
        try:
            align_len = int(_child_text(hsp, ("align-len", "Hsp_align-len")))
            identity = int(_child_text(hsp, ("identity", "Hsp_identity")))
            q_from = int(_child_text(hsp, ("query-from", "Hsp_query-from")))
            q_to = int(_child_text(hsp, ("query-to", "Hsp_query-to")))
            h_from = int(_child_text(hsp, ("hit-from", "Hsp_hit-from")))
            h_to = int(_child_text(hsp, ("hit-to", "Hsp_hit-to")))
            e_value = float(_child_text(hsp, ("evalue", "Hsp_evalue")))
            bit_score = float(_child_text(hsp, ("bit-score", "Hsp_bit-score")))
        except (TypeError, ValueError) as exc:
            raise BlastResultError("BLAST HSP contains invalid numeric fields") from exc
        if align_len <= 0:
            raise BlastResultError("BLAST HSP alignment length is invalid")
        coverage = abs(q_to - q_from) + 1
        hits.append({
            "rank": len(hits) + 1,
            "subject_id": subject_id[:512],
            "title": title[:2000],
            "identity_percent": round(identity * 100.0 / align_len, 6),
            "alignment_length": align_len,
            "query_coverage_percent": round(coverage * 100.0 / query_len, 6),
            "e_value": e_value,
            "bit_score": bit_score,
            "query_from": q_from,
            "query_to": q_to,
            "subject_from": h_from,
            "subject_to": h_to,
        })

    summary = {"query_sha256": query_sha256, "query_length": query_len, "hit_count": len(hits)}
    return BlastResult(data, blast_version[:128], database[:256], db_release[:256] if db_release else None, summary, hits)


class NcbiBlastClient:
    def __init__(self, *, tool: str, email: str, timeout: float = 60.0) -> None:
        if not tool.strip() or not email.strip():
            raise ValueError("NCBI tool and email are required")
        self.tool = tool.strip()
        self.email = email.strip()
        self.timeout = timeout
        self._last_request = 0.0

    def _request(self, params: dict[str, str]) -> bytes:
        elapsed = time.monotonic() - self._last_request
        if elapsed < 10.0:
            time.sleep(10.0 - elapsed)
        body = urlencode({**params, "TOOL": self.tool, "EMAIL": self.email}).encode("ascii")
        request = Request(BLAST_URL, data=body, headers={"Content-Type": "application/x-www-form-urlencoded", "User-Agent": f"{self.tool}/{SERVICE_VERSION}"}, method="POST")
        try:
            with urlopen(request, timeout=self.timeout) as response:
                data = response.read(MAX_RESULT_BYTES + 1)
        except HTTPError as exc:
            raise BlastRemoteError(f"NCBI BLAST HTTP {exc.code}") from exc
        except URLError as exc:
            raise BlastRemoteError("NCBI BLAST connection failed") from exc
        finally:
            self._last_request = time.monotonic()
        if len(data) > MAX_RESULT_BYTES:
            raise BlastRemoteError("NCBI BLAST response exceeds allowed size")
        return data

    def submit(self, *, program: str, database: str, query_fasta: str, expect: str, max_targets: int, low_complexity_filter: bool) -> BlastSubmission:
        if program not in {"blastn", "blastp"} or database not in {"core_nt", "swissprot"}:
            raise ValueError("unsupported BLAST configuration")
        data = self._request({
            "CMD": "Put",
            "PROGRAM": program,
            "DATABASE": database,
            "QUERY": query_fasta,
            "EXPECT": expect,
            "HITLIST_SIZE": str(max_targets),
            "FILTER": "L" if low_complexity_filter else "F",
        })
        return parse_submission(data)

    def status(self, rid: str) -> str:
        return parse_search_info(self._request({"CMD": "Get", "RID": rid, "FORMAT_OBJECT": "SearchInfo"}))

    def result(self, rid: str, *, query_sha256: str, max_targets: int) -> BlastResult:
        data = self._request({"CMD": "Get", "RID": rid, "FORMAT_TYPE": "XML2"})
        return parse_xml2(data, query_sha256=query_sha256, max_targets=max_targets)
