import os
from fastapi.testclient import TestClient
from app import app

client = TestClient(app)

def test_health():
    assert client.get("/health").json() == {"status": "ok"}

def test_requires_key():
    assert client.post("/api/analytics/summary", json={"results": [{"course": "Test", "score": 80}]}).status_code == 401

def test_summary():
    os.environ["ANALYTICS_API_KEY"] = "test-key"
    response = client.post("/api/analytics/summary", headers={"x-analytics-key": "test-key"}, json={"results": [{"course": "Test", "score": 80}, {"course": "Test", "score": 100}]})
    assert response.status_code == 200
    assert response.json()["courses"][0]["average"] == 90
    assert "data" in response.json()["chart"]

def test_invalid_score():
    assert client.post("/api/analytics/summary", json={"results": [{"course": "Test", "score": 120}]}).status_code == 422
