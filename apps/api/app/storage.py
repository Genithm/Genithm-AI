from __future__ import annotations

from dataclasses import dataclass
from typing import Protocol

import boto3
from botocore.config import Config
from botocore.exceptions import BotoCoreError, ClientError


@dataclass(frozen=True, slots=True)
class ObjectMetadata:
    key: str
    size_bytes: int
    content_type: str | None
    etag: str | None


class StorageProvider(Protocol):
    def put(self, key: str, body: bytes, *, content_type: str) -> None: ...
    def get(self, key: str, *, max_bytes: int) -> bytes: ...
    def delete(self, key: str) -> None: ...
    def exists(self, key: str) -> bool: ...
    def metadata(self, key: str) -> ObjectMetadata: ...
    def signed_upload(self, key: str, *, content_type: str, expires_seconds: int) -> str: ...
    def signed_download(self, key: str, *, expires_seconds: int) -> str: ...


class StorageError(RuntimeError):
    pass


class R2StorageProvider:
    def __init__(
        self,
        *,
        endpoint_url: str,
        access_key_id: str,
        secret_access_key: str,
        bucket: str,
    ) -> None:
        self.bucket = bucket
        self.client = boto3.client(
            "s3",
            endpoint_url=endpoint_url,
            aws_access_key_id=access_key_id,
            aws_secret_access_key=secret_access_key,
            region_name="auto",
            config=Config(signature_version="s3v4", retries={"max_attempts": 3, "mode": "standard"}),
        )

    def put(self, key: str, body: bytes, *, content_type: str) -> None:
        try:
            self.client.put_object(Bucket=self.bucket, Key=key, Body=body, ContentType=content_type)
        except (BotoCoreError, ClientError) as exc:
            raise StorageError("R2 put failed") from exc

    def get(self, key: str, *, max_bytes: int) -> bytes:
        try:
            response = self.client.get_object(Bucket=self.bucket, Key=key)
            body = response["Body"]
            data = body.read(max_bytes + 1)
        except (BotoCoreError, ClientError, KeyError) as exc:
            raise StorageError("R2 get failed") from exc
        if len(data) > max_bytes:
            raise StorageError("R2 object exceeded configured size limit")
        return data

    def delete(self, key: str) -> None:
        try:
            self.client.delete_object(Bucket=self.bucket, Key=key)
        except (BotoCoreError, ClientError) as exc:
            raise StorageError("R2 delete failed") from exc

    def metadata(self, key: str) -> ObjectMetadata:
        try:
            response = self.client.head_object(Bucket=self.bucket, Key=key)
        except (BotoCoreError, ClientError) as exc:
            raise StorageError("R2 metadata lookup failed") from exc
        return ObjectMetadata(
            key=key,
            size_bytes=int(response.get("ContentLength", -1)),
            content_type=response.get("ContentType"),
            etag=str(response.get("ETag", "")).strip('"') or None,
        )

    def exists(self, key: str) -> bool:
        try:
            self.metadata(key)
            return True
        except StorageError:
            return False

    def signed_upload(self, key: str, *, content_type: str, expires_seconds: int) -> str:
        try:
            return self.client.generate_presigned_url(
                "put_object",
                Params={"Bucket": self.bucket, "Key": key, "ContentType": content_type},
                ExpiresIn=expires_seconds,
                HttpMethod="PUT",
            )
        except (BotoCoreError, ClientError) as exc:
            raise StorageError("R2 upload signing failed") from exc

    def signed_download(self, key: str, *, expires_seconds: int) -> str:
        try:
            return self.client.generate_presigned_url(
                "get_object",
                Params={"Bucket": self.bucket, "Key": key},
                ExpiresIn=expires_seconds,
                HttpMethod="GET",
            )
        except (BotoCoreError, ClientError) as exc:
            raise StorageError("R2 download signing failed") from exc
