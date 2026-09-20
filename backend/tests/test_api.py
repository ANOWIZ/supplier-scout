from datetime import date

from fastapi.testclient import TestClient

from app.main import app
from app.scoring import score_supplier


def test_health_and_snapshot_date():
    with TestClient(app) as client:
        response = client.get("/api/v1/health")
    assert response.status_code == 200
    assert response.json() == {"status": "ok", "snapshot": "2026-09-20"}


def test_filters_and_stable_sort():
    with TestClient(app) as client:
        response = client.get(
            "/api/v1/suppliers",
            params={"region": "Екатеринбург", "requested_kg": 10, "delivery_only": True},
        )
    payload = response.json()
    assert response.status_code == 200
    assert payload["count"] > 0
    scores = [item["score"]["total"] for item in payload["items"]]
    assert scores == sorted(scores, reverse=True)


def test_minimum_fit_does_not_treat_unknown_as_match():
    with TestClient(app) as client:
        payload = client.get(
            "/api/v1/suppliers",
            params={"requested_kg": 10, "minimum_fit": True},
        ).json()
    assert payload["items"]
    assert all(item["minimum_order"]["kg"] is not None for item in payload["items"])
    assert all(item["minimum_order"]["kg"] <= 10 for item in payload["items"])


def test_unknown_minimum_is_not_treated_as_zero():
    supplier = {
        "products": ["Кофе в зернах"],
        "delivers_to_ekaterinburg": True,
        "minimum_order": {"kg": None},
        "price": {"amount": None},
        "verified_at": "2026-09-20",
        "sources": [{"type": "official"}],
    }
    scored = score_supplier(supplier, requested_kg=10, today=date(2026, 9, 20))
    assert scored["breakdown"]["minimum_fit"] == 8
    assert scored["total"] == sum(scored["breakdown"].values())


def test_empty_sources_get_no_reliability_points():
    supplier = {
        "products": ["Кофе в зернах"],
        "delivers_to_ekaterinburg": True,
        "minimum_order": {"kg": 5},
        "price": {"amount": None},
        "website": "https://example.com",
        "verified_at": "2026-09-20",
        "sources": [],
    }
    assert score_supplier(supplier, today=date(2026, 9, 20))["breakdown"]["source_reliability"] == 0


def test_compare_rejects_unknown_supplier():
    with TestClient(app) as client:
        response = client.post(
            "/api/v1/compare",
            json={"supplier_ids": ["does-not-exist"], "requested_kg": 10},
        )
    assert response.status_code == 404


def test_every_supplier_has_official_evidence():
    with TestClient(app) as client:
        items = client.get("/api/v1/suppliers").json()["items"]
    assert len(items) >= 8
    for supplier in items:
        assert supplier["sources"]
        assert supplier["evidence"]
        assert all(source["url"].startswith("https://") for source in supplier["sources"])
