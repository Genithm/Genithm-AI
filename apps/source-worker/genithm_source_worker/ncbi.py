from __future__ import annotations

import time
import xml.etree.ElementTree as ET
from dataclasses import dataclass
from urllib.error import HTTPError, URLError
from urllib.parse import urlencode
from urllib.request import Request, urlopen

CONNECTOR_VERSION = "genithm-ncbi-connector/0.1.0"
EFETCH_URL = "https://eutils.ncbi.nlm.nih.gov/entrez/eutils/efetch.fcgi"
MAX_RESPONSE_BYTES = 55 * 1024 * 1024


class NcbiRecordNotFound(LookupError):
    pass


class NcbiResponseError(ValueError):
    pass


@dataclass(frozen=True, slots=True)
class NcbiRecord:
    database: str
    requested_accession: str
    accession_version: str
    title: str
    organism: str
    length: int
    updated_date: str
    sequence: str

    def fasta_bytes(self) -> bytes:
        header = f">{self.accession_version} {self.title}".strip()
        lines = [header]
        lines.extend(self.sequence[index : index + 80] for index in range(0, len(self.sequence), 80))
        return ("\n".join(lines) + "\n").encode("ascii")


def _text(node: ET.Element, tag: str) -> str:
    value = node.findtext(tag)
    return value.strip() if value else ""


def parse_gbseq_xml(data: bytes, *, database: str, requested_accession: str) -> NcbiRecord:
    if not data or len(data) > MAX_RESPONSE_BYTES:
        raise NcbiResponseError("NCBI response is empty or exceeds the allowed size")
    try:
        root = ET.fromstring(data)
    except ET.ParseError as exc:
        raise NcbiResponseError("NCBI returned malformed XML") from exc

    records = root.findall(".//GBSeq")
    if not records:
        raise NcbiRecordNotFound(requested_accession)
    if len(records) != 1:
        raise NcbiResponseError("NCBI returned an unexpected number of records")

    record = records[0]
    accession_version = _text(record, "GBSeq_accession-version").upper()
    title = _text(record, "GBSeq_definition")
    organism = _text(record, "GBSeq_organism")
    updated_date = _text(record, "GBSeq_update-date")
    sequence = "".join(_text(record, "GBSeq_sequence").split()).upper()
    length_text = _text(record, "GBSeq_length")

    if not accession_version or not sequence or not length_text.isdigit():
        raise NcbiResponseError("NCBI record is missing required sequence metadata")
    length = int(length_text)
    if length <= 0 or len(sequence) != length:
        raise NcbiResponseError("NCBI sequence length does not match record metadata")

    requested = requested_accession.upper()
    if accession_version.split(".", 1)[0] != requested.split(".", 1)[0]:
        raise NcbiResponseError("NCBI resolved a different accession")
    if "." in requested and accession_version != requested:
        raise NcbiResponseError("NCBI returned a different accession version")

    return NcbiRecord(database, requested, accession_version, title, organism, length, updated_date, sequence)


class NcbiConnector:
    def __init__(self, *, tool: str, email: str, api_key: str | None = None, timeout: float = 30.0) -> None:
        if not tool.strip() or not email.strip():
            raise ValueError("NCBI tool and email are required")
        self.tool = tool.strip()
        self.email = email.strip()
        self.api_key = api_key.strip() if api_key else None
        self.timeout = timeout

    def fetch(self, database: str, accession: str) -> NcbiRecord:
        db = database.lower().strip()
        if db not in {"nucleotide", "protein"}:
            raise ValueError("unsupported NCBI database")
        params = {
            "db": "nuccore" if db == "nucleotide" else "protein",
            "id": accession,
            "rettype": "gb" if db == "nucleotide" else "gp",
            "retmode": "xml",
            "tool": self.tool,
            "email": self.email,
        }
        if self.api_key:
            params["api_key"] = self.api_key
        url = f"{EFETCH_URL}?{urlencode(params)}"

        for attempt in range(3):
            request = Request(url, headers={"User-Agent": f"{self.tool}/{CONNECTOR_VERSION}"}, method="GET")
            try:
                with urlopen(request, timeout=self.timeout) as response:
                    data = response.read(MAX_RESPONSE_BYTES + 1)
                if len(data) > MAX_RESPONSE_BYTES:
                    raise NcbiResponseError("NCBI response exceeds the allowed size")
                return parse_gbseq_xml(data, database=db, requested_accession=accession)
            except HTTPError as exc:
                if exc.code == 404:
                    raise NcbiRecordNotFound(accession) from exc
                if exc.code not in {429, 500, 502, 503, 504} or attempt == 2:
                    raise RuntimeError(f"NCBI EFetch failed with HTTP {exc.code}") from exc
                retry_after = exc.headers.get("Retry-After")
                delay = min(float(retry_after), 5.0) if retry_after and retry_after.isdigit() else 0.5 * (2**attempt)
                time.sleep(delay)
            except URLError as exc:
                if attempt == 2:
                    raise RuntimeError("NCBI EFetch connection failed") from exc
                time.sleep(0.5 * (2**attempt))
        raise RuntimeError("NCBI EFetch retry policy exhausted")
