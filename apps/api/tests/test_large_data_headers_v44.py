from fastapi import FastAPI
from fastapi.testclient import TestClient
from app.large_data.routes import LargeDataBodyLimit


def test_metadata_limit_rejections_never_cache():
    app=FastAPI();app.add_middleware(LargeDataBodyLimit)
    with TestClient(app) as client:
        response=client.post("/api/v1/large-data/uploads",content=b"x"*16385)
        assert response.status_code==413
        assert response.headers["cache-control"]=="no-store"
        assert response.headers["x-content-type-options"]=="nosniff"
