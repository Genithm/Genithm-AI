from __future__ import annotations

import boto3
from botocore.config import Config
from botocore.exceptions import ClientError
from .policy import LargeDataConfig, LargeDataError, URL_TTL, part_size


class MultipartStorage:
    """Only API-generated quarantine keys. No bucket creation or public ACLs."""
    def __init__(self, config: LargeDataConfig):
        self.config = config
        opts = dict(signature_version="s3v4", connect_timeout=10, read_timeout=120,
                    s3={"addressing_style": "path"}, request_checksum_calculation="when_required",
                    response_checksum_validation="when_required")
        common = dict(aws_access_key_id=config.access_key, aws_secret_access_key=config.secret_key,
                      region_name=config.region)
        self.client = boto3.client("s3", endpoint_url=config.endpoint, **common,
                                   config=Config(retries={"total_max_attempts": 3, "mode": "standard"}, **opts))
        self.mutator = boto3.client("s3", endpoint_url=config.endpoint, **common,
                                    config=Config(retries={"total_max_attempts": 1}, **opts))
        self.signer = boto3.client("s3", endpoint_url=config.public_endpoint, **common,
                                   config=Config(retries={"total_max_attempts": 1}, **opts))

    def _target(self, row):
        from uuid import UUID
        ids = [str(UUID(str(row[k]))) for k in ("organization_id", "project_id", "id")]
        expected = "quarantine/" + "/".join(ids) + "/input"
        if row["object_key"] != expected or row["storage_identity"] != self.config.identity:
            raise LargeDataError("storage_scope_changed", 409)
        return {"Bucket": self.config.bucket, "Key": expected}

    def create(self, row):
        return self.mutator.create_multipart_upload(**self._target(row),
            ContentType="application/octet-stream", Metadata={"genithm-upload": row["id"],
            "source-sha256": row["expected_sha256"]})["UploadId"]

    def sign(self, row, number: int):
        params = {**self._target(row), "UploadId": row["provider_upload_id"],
                  "PartNumber": number,
                  "ContentLength": part_size(row["expected_bytes"], number, row["part_bytes"])}
        # Content-Length is signed, preventing a part from exceeding its reserved size.
        # Browsers set it automatically from the Blob; never send an account credential.
        return self.signer.generate_presigned_url("upload_part", Params=params, ExpiresIn=URL_TTL,
                                                   HttpMethod="PUT")

    def parts(self, row):
        result = []
        for page in self.client.get_paginator("list_parts").paginate(
                **self._target(row), UploadId=row["provider_upload_id"]):
            for p in page.get("Parts", []):
                result.append({"number": int(p["PartNumber"]), "size": int(p["Size"]), "etag": p["ETag"]})
                if len(result) > 10000:
                    raise LargeDataError("provider_parts_invalid", 502)
        return sorted(result, key=lambda p: p["number"])

    def validate_parts(self, row, parts):
        count = (row["expected_bytes"] + row["part_bytes"] - 1) // row["part_bytes"]
        if len(parts) != count or any(p["number"] != i + 1 or
             p["size"] != part_size(row["expected_bytes"], i + 1, row["part_bytes"])
             for i, p in enumerate(parts)):
            raise LargeDataError("upload_parts_incomplete", 409)

    def complete(self, row, parts):
        self.validate_parts(row, parts)
        self.mutator.complete_multipart_upload(**self._target(row), UploadId=row["provider_upload_id"],
             MultipartUpload={"Parts": [{"PartNumber": p["number"], "ETag": p["etag"]} for p in parts]})

    def head(self, row):
        try:
            data = self.client.head_object(**self._target(row))
        except ClientError as exc:
            if str(exc.response.get("Error", {}).get("Code")) in {"404", "NoSuchKey", "NotFound"}:
                return None
            raise
        if (data["ContentLength"] != row["expected_bytes"] or
            data.get("Metadata", {}).get("genithm-upload") != row["id"] or
            data.get("Metadata", {}).get("source-sha256") != row["expected_sha256"]):
            raise LargeDataError("uploaded_object_identity_mismatch")
        return {"size": data["ContentLength"], "etag": data["ETag"]}

    def open(self, row):
        return self.client.get_object(**self._target(row), IfMatch=row["object_etag"])["Body"]

    def cleanup(self, row):
        """Must be called only with an exclusive DB abort lease, after signed URLs expire."""
        target = self._target(row)
        # Reconcile a lost create response using the unique, server-created key.
        for page in self.client.get_paginator("list_multipart_uploads").paginate(
                Bucket=target["Bucket"], Prefix=target["Key"]):
            for item in page.get("Uploads", []):
                if item["Key"] == target["Key"]:
                    self.mutator.abort_multipart_upload(**target, UploadId=item["UploadId"])
        self.mutator.delete_object(**target)
        # Failure/uncertainty keeps quota charged; no delete-before-confirmation success.
        if self.head(row) is not None:
            raise LargeDataError("cleanup_not_confirmed")
        for page in self.client.get_paginator("list_multipart_uploads").paginate(
                Bucket=target["Bucket"], Prefix=target["Key"]):
            if any(x["Key"] == target["Key"] for x in page.get("Uploads", [])):
                raise LargeDataError("cleanup_not_confirmed")
