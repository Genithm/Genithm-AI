from __future__ import annotations

import os
from dataclasses import dataclass
from urllib.parse import urlsplit

MIB = 1024 ** 2
GIB = 1024 ** 3
MAX_BYTES = 100 * GIB
PART_BYTES = 64 * MIB
CHUNK_BYTES = MIB
URL_TTL = 300


class LargeDataError(RuntimeError):
    def __init__(self, code: str, status: int = 409):
        super().__init__(code)
        self.code, self.status = code, status


@dataclass(frozen=True)
class LargeDataConfig:
    endpoint: str
    public_endpoint: str
    bucket: str
    access_key: str
    secret_key: str
    max_expanded_bytes: int = 200 * GIB
    region: str = "auto"
    allow_loopback: bool = False

    def __post_init__(self):
        import re
        for endpoint in (self.endpoint, self.public_endpoint):
            u = urlsplit(endpoint)
            loopback = self.allow_loopback and u.hostname in {"localhost", "127.0.0.1", "::1"}
            if (not u.hostname or u.username or u.password or u.query or u.fragment
                    or u.path not in {"", "/"} or (u.scheme != "https" and not (loopback and u.scheme == "http"))):
                raise ValueError("Large-data endpoints require HTTPS origins; loopback HTTP is test-only")
        if not re.fullmatch(r"[a-z0-9][a-z0-9.-]{1,61}[a-z0-9]", self.bucket):
            raise ValueError("Invalid dedicated private large-data bucket")
        if not self.access_key or not self.secret_key or not GIB <= self.max_expanded_bytes <= 500 * GIB:
            raise ValueError("Missing credentials or unsafe expanded-byte limit")

    @classmethod
    def from_env(cls):
        if os.getenv("GENITHM_LARGE_DATA_ENABLED", "").lower() != "true":
            raise LargeDataError("large_data_not_enabled", 503)
        names = ["ENDPOINT", "BUCKET", "ACCESS_KEY_ID", "SECRET_ACCESS_KEY"]
        values = [os.getenv("GENITHM_LARGE_DATA_" + n, "").strip() for n in names]
        try:
            return cls(values[0], os.getenv("GENITHM_LARGE_DATA_PUBLIC_ENDPOINT", values[0]).strip(),
                       values[1], values[2], values[3],
                       int(os.getenv("GENITHM_LARGE_DATA_MAX_EXPANDED_BYTES", str(200 * GIB))),
                       region=os.getenv("GENITHM_LARGE_DATA_REGION", "auto"))
        except (ValueError, TypeError) as exc:
            raise LargeDataError("large_data_configuration_invalid", 503) from exc

    @property
    def identity(self):
        from hashlib import sha256
        return sha256((self.endpoint.rstrip("/") + "/" + self.bucket).encode()).hexdigest()


def part_size(total: int, number: int, part_bytes: int = PART_BYTES) -> int:
    if type(total) is not int or not 1 <= total <= MAX_BYTES or type(number) is not int:
        raise LargeDataError("invalid_part", 422)
    count = (total + part_bytes - 1) // part_bytes
    if not 1 <= number <= count:
        raise LargeDataError("invalid_part", 422)
    return min(part_bytes, total - (number - 1) * part_bytes)
