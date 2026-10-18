import base64
import hashlib
import io
from contextlib import contextmanager

import boto3
import pytest
from botocore.config import Config
from botocore.response import StreamingBody
from botocore.stub import Stubber

from app.bulk_s3 import S3MultipartStore
from app.bulk_transfer import Part, TransferError


def client(endpoint='https://example.invalid', attempts=1):
    return boto3.client('s3', endpoint_url=endpoint, aws_access_key_id='test',
                        aws_secret_access_key='test', region_name='auto',
                        config=Config(retries={'total_max_attempts': attempts},
                                      request_checksum_calculation='when_required'))


def test_storage_requires_safe_transport_and_explicit_retry_policy():
    with pytest.raises(TransferError, match='HTTPS'):
        S3MultipartStore(client('http://evil.example'), 'datasets')
    with pytest.raises(TransferError, match='disable automatic'):
        S3MultipartStore(client(attempts=3), 'datasets')
    with pytest.raises(TransferError):
        S3MultipartStore(client('http://127.0.0.1:9000'), 'datasets')
    S3MultipartStore(client('http://127.0.0.1:9000'), 'datasets', allow_loopback_http=True)


def test_md5_protects_each_upload_and_sha_is_not_inferred_from_etag():
    c = client()
    store = S3MultipartStore(c, 'datasets')
    data = b'actual bytes'
    with Stubber(c) as stub:
        stub.add_response('upload_part', {'ETag': 'opaque-part-etag'}, {
            'Bucket': 'datasets', 'Key': 'scoped/key', 'UploadId': 'one',
            'PartNumber': 1, 'Body': data, 'ContentLength': len(data),
            'ContentMD5': base64.b64encode(hashlib.md5(data, usedforsecurity=False).digest()).decode()})
        assert store.upload('scoped/key', 'one', 1, data) == 'opaque-part-etag'
        stub.assert_no_pending_responses()


def test_list_paginates_with_authoritative_part_metadata():
    c = client()
    store = S3MultipartStore(c, 'datasets')
    with Stubber(c) as stub:
        for marker, truncated, nxt, number in [(0, True, 1, 1), (1, False, 2, 2)]:
            stub.add_response('list_parts', {
                'IsTruncated': truncated, 'NextPartNumberMarker': nxt,
                'Parts': [{'PartNumber': number, 'Size': 9, 'ETag': str(number)}]},
                {'Bucket': 'datasets', 'Key': 'scoped/key', 'UploadId': 'one',
                 'MaxParts': 1000, 'PartNumberMarker': marker})
        assert store.list_parts('scoped/key', 'one') == [Part(1, 9, '1'), Part(2, 9, '2')]


def test_auth_errors_are_not_interpreted_as_absent_objects():
    c = client()
    store = S3MultipartStore(c, 'datasets')
    with Stubber(c) as stub:
        stub.add_client_error('head_object', service_error_code='AccessDenied', http_status_code=403)
        with pytest.raises(TransferError):
            store.head('key')
        stub.add_client_error('head_object', service_error_code='404', http_status_code=404)
        assert store.head('key') is None


def test_get_is_conditional_and_closes_body_on_error():
    c = client()
    store = S3MultipartStore(c, 'datasets')
    raw = io.BytesIO(b'data')
    body = StreamingBody(raw, 4)
    with Stubber(c) as stub:
        stub.add_response('get_object', {'Body': body}, {'Bucket': 'datasets', 'Key': 'key', 'IfMatch': 'etag'})
        with pytest.raises(ValueError):
            with store.open('key', 'etag') as stream:
                assert stream.read(1) == b'd'
                raise ValueError('fixture')
        assert raw.closed
