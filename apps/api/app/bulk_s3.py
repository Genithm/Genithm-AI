"""S3/R2 adapter for the internal large-dataset transfer engine.

The configured client/bucket are operator-trusted, never loaded from a supplied
checkpoint. No bucket creation, credentials discovery, or public ACL mutation.
"""
from __future__ import annotations

import base64
import hashlib
from contextlib import contextmanager
from typing import Iterator, BinaryIO
from urllib.parse import urlparse

from botocore.exceptions import BotoCoreError, ClientError, ConnectionClosedError, EndpointConnectionError, ReadTimeoutError

from .bulk_transfer import MAX_PARTS, ObjectInfo, Part, RetryableTransferError, TransferError


class S3MultipartStore:
    def __init__(self, client, bucket: str, *, allow_loopback_http: bool = False):
        retries = client.meta.config.retries or {}
        if retries.get("total_max_attempts") != 1:
            raise TransferError("Multipart client must disable automatic SDK retries; the engine retries parts only")
        endpoint = client.meta.endpoint_url
        parsed = urlparse(endpoint)
        if (parsed.username or parsed.password or parsed.query or parsed.fragment
                or (parsed.scheme != "https" and not
                    (allow_loopback_http and parsed.scheme == "http" and parsed.hostname in {"127.0.0.1", "localhost", "::1"}))):
            raise TransferError("Large-data storage requires HTTPS (loopback-only HTTP tests permitted)")
        if not bucket or len(bucket) > 255 or "/" in bucket:
            raise TransferError("Invalid configured storage bucket")
        self.client, self.bucket = client, bucket
        self.binding = hashlib.sha256((endpoint.rstrip("/") + "\n" + bucket).encode()).hexdigest()

    def _call(self, operation: str, **kwargs):
        try:
            return getattr(self.client, operation)(Bucket=self.bucket, **kwargs)
        except (EndpointConnectionError, ReadTimeoutError, ConnectionClosedError) as exc:
            raise RetryableTransferError("Storage transport interrupted") from exc
        except ClientError as exc:
            status = exc.response.get("ResponseMetadata", {}).get("HTTPStatusCode", 0)
            if status in {429, 500, 502, 503, 504}:
                raise RetryableTransferError("Storage temporarily unavailable") from exc
            raise TransferError("Storage operation rejected") from exc
        except BotoCoreError as exc:
            raise TransferError("Storage operation failed") from exc

    def head(self, key: str) -> ObjectInfo | None:
        try:
            info = self.client.head_object(Bucket=self.bucket, Key=key)
        except ClientError as exc:
            if exc.response.get("Error", {}).get("Code") in {"NoSuchKey", "NotFound", "404"}:
                return None
            # Authentication/authorization failures are NEVER treated as absence.
            raise TransferError("Storage metadata access failed") from exc
        except BotoCoreError as exc:
            raise TransferError("Storage metadata lookup failed") from exc
        if type(info.get("ContentLength")) is not int or not isinstance(info.get("ETag"), str):
            raise TransferError("Invalid storage object metadata")
        return ObjectInfo(info["ContentLength"], info["ETag"], info.get("Metadata", {}))

    def create(self, key: str, metadata: dict[str, str]) -> str:
        # SDK retries of non-idempotent create/completion must be disabled on the
        # injected client. The caller must also own the reserved target lease.
        response = self._call("create_multipart_upload", Key=key,
                              ContentType="application/octet-stream", Metadata=metadata)
        upload_id = response.get("UploadId")
        if not isinstance(upload_id, str) or not upload_id:
            raise TransferError("Storage did not return a multipart identifier")
        return upload_id

    def list_parts(self, key: str, upload_id: str) -> list[Part]:
        parts: list[Part] = []
        marker = 0
        while True:
            response = self._call("list_parts", Key=key, UploadId=upload_id,
                                  MaxParts=1000, PartNumberMarker=marker)
            for item in response.get("Parts", []):
                number, size, etag = item.get("PartNumber"), item.get("Size"), item.get("ETag")
                if (type(number) is not int or number <= marker or not 1 <= number <= MAX_PARTS
                        or type(size) is not int or size < 1 or not isinstance(etag, str)
                        or not 1 <= len(etag) <= 256):
                    raise TransferError("Invalid multipart storage listing")
                parts.append(Part(number, size, etag))
                if len(parts) > MAX_PARTS:
                    raise TransferError("Multipart listing exceeded limit")
            if not response.get("IsTruncated", False):
                return parts
            next_marker = response.get("NextPartNumberMarker")
            if type(next_marker) is not int or not marker < next_marker <= MAX_PARTS:
                raise TransferError("Multipart listing failed to advance")
            marker = next_marker

    def upload(self, key: str, upload_id: str, number: int, data: bytes) -> str:
        # Content-MD5 protects a transport part, not scientific or whole-file
        # identity; the engine separately checks SHA-256 of the entire object.
        md5 = base64.b64encode(hashlib.md5(data, usedforsecurity=False).digest()).decode("ascii")
        response = self._call("upload_part", Key=key, UploadId=upload_id, PartNumber=number,
                              Body=data, ContentLength=len(data), ContentMD5=md5)
        etag = response.get("ETag")
        if not isinstance(etag, str) or not 1 <= len(etag) <= 256:
            raise TransferError("Storage returned an invalid part ETag")
        return etag

    def complete(self, key: str, upload_id: str, parts: list[Part]) -> None:
        self._call("complete_multipart_upload", Key=key, UploadId=upload_id,
                   MultipartUpload={"Parts": [{"PartNumber": p.number, "ETag": p.etag} for p in parts]})

    def abort(self, key: str, upload_id: str) -> None:
        self._call("abort_multipart_upload", Key=key, UploadId=upload_id)

    @contextmanager
    def open(self, key: str, etag: str) -> Iterator[BinaryIO]:
        response = self._call("get_object", Key=key, IfMatch=etag)
        stream = response.get("Body")
        if stream is None or not hasattr(stream, "read"):
            raise TransferError("Storage returned no object stream")
        try:
            yield stream
        finally:
            stream.close()
