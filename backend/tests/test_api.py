import json
from datetime import date
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from app.main import app
from app.database import load_snapshot
from app.scoring import minimum_matches, score_supplier

CASES = json.loads((Path(__file__).parents[2] / "data" / "scoring-cases.json").read_text(encoding="utf-8"))


@pytest.mark.parametrize("case", CASES, ids=lambda case: case["name"])
def test_shared_scoring_cases(case):
    supplier = {
        "offers": {
            "coffee-beans": {"minimum_order": {"kg": case["kg"], "rub": case["rub"], "period": case["minPeriod"]}, "price": {"amount": None}},
            "tea": {"minimum_order": {"kg": None, "rub": None, "period": "unknown"}, "price": {"amount": None}},
        },
        "delivery_regions": {"Екатеринбург": True, "Москва": None},
        "verified_at": "2026-09-21",
        "website": "https://example.com",
        "sources": [{"type": "official", "url": "https://example.com"}],
    }
    score = score_supplier(supplier, case["requestedKg"], date(2026, 9, 21),
                           category=case["category"], region=case["region"], requested_period=case["period"])
    assert score["breakdown"] == {
        "product_match": case["product"], "delivery_region": case["delivery"],
        "minimum_fit": case["minimum"], "source_reliability": 15, "freshness": 10, "price_transparency": 0,
    }
    assert score["total"] == case["product"] + case["delivery"] + case["minimum"] + 25


@pytest.fixture
def client():
    with TestClient(app) as instance:
        yield instance


def test_health_catalog_and_categories(client):
    assert client.get("/api/v1/health").json() == {"status": "ok", "snapshot": load_snapshot()["meta"]["verified_at"]}
    catalog = client.get("/api/v1/catalog").json()
    assert len(catalog["suppliers"]) == 10
    assert client.get("/api/v1/products").json() == catalog["meta"]["categories"]
    assert len(catalog["meta"]["categories"]) == 2


def test_filters_and_stable_scores(client):
    response = client.get("/api/v1/suppliers", params={"region": "Екатеринбург", "requested_kg": 10, "delivery_only": True})
    payload = response.json()
    assert response.status_code == 200
    assert payload["count"] > 0
    scores = [item["score"]["total"] for item in payload["items"]]
    assert scores == sorted(scores, reverse=True)
    assert payload["items"] == sorted(payload["items"], key=lambda item: (-item["score"]["total"], item["id"]))
    assert all(item["delivery_regions"]["Екатеринбург"] is True for item in payload["items"])


def test_category_region_and_price_filters(client):
    tea = client.get("/api/v1/suppliers", params={"category": "tea"}).json()["items"]
    assert len(tea) == 4
    assert all("tea" in item["offers"] for item in tea)
    assert client.get("/api/v1/suppliers", params={"category": "tea", "price_published": True}).json()["count"] == 0
    ekb = client.get("/api/v1/suppliers", params={"region": "Екатеринбург", "delivery_only": True}).json()["items"]
    moscow = client.get("/api/v1/suppliers", params={"region": "Москва", "delivery_only": True}).json()["items"]
    assert "snabcoffee" in {item["id"] for item in ekb}
    assert "snabcoffee" not in {item["id"] for item in moscow}
    assert "gfc-russia" in {item["id"] for item in moscow}
    assert "gfc-russia" not in {item["id"] for item in ekb}


def test_minimum_filter_is_category_and_period_specific(client):
    items = client.get("/api/v1/suppliers", params={"requested_kg": 10, "minimum_fit": True}).json()["items"]
    assert items
    assert all(minimum_matches(item, "coffee-beans", 10, "order") for item in items)
    assert "frumentum" not in {item["id"] for item in items}
    assert client.get("/api/v1/suppliers", params={"minimum_fit": True, "requested_period": "month"}).json()["count"] == 0
    assert client.get("/api/v1/suppliers", params={"category": "tea", "minimum_fit": True}).json()["count"] == 0


def test_detail_compare_and_list_share_context(client):
    criteria = {"category": "tea", "region": "Москва", "requested_period": "month", "requested_kg": 20}
    items = client.get("/api/v1/suppliers", params=criteria).json()["items"]
    selected = [item["id"] for item in items[:3]]
    comparison = client.post("/api/v1/compare", json={**criteria, "supplier_ids": selected}).json()
    assert "recommended_id" not in comparison
    assert comparison["leading_ids"]
    for item in comparison["items"]:
        detail = client.get("/api/v1/suppliers/" + item["id"], params=criteria).json()
        original = next(row for row in items if row["id"] == item["id"])
        assert detail["score"] == item["score"] == original["score"]


def test_tied_scores_do_not_pick_a_single_recommendation(client):
    comparison = client.post("/api/v1/compare", json={"supplier_ids": ["bacca", "berucoffee"]}).json()
    assert set(comparison["leading_ids"]) == {"bacca", "berucoffee"}


@pytest.mark.parametrize("params", [{"category": "milk"}, {"region": "unknown"}, {"requested_period": "year"}, {"requested_kg": 0}, {"requested_kg": 100001}])
def test_invalid_search_input_is_rejected(client, params):
    assert client.get("/api/v1/suppliers", params=params).status_code == 422


def test_compare_rejects_unknown_or_incompatible_supplier(client):
    assert client.post("/api/v1/compare", json={"supplier_ids": ["does-not-exist"]}).status_code == 404
    assert client.post("/api/v1/compare", json={"supplier_ids": ["bacca"], "category": "tea"}).status_code == 422
    assert client.get("/api/v1/suppliers/bacca", params={"category": "tea"}).status_code == 422


def test_every_supplier_has_contacts_and_official_evidence(client):
    items = client.get("/api/v1/catalog").json()["suppliers"]
    for supplier in items:
        assert supplier["contacts"]["phone"] or supplier["contacts"]["email"]
        assert supplier["sources"] and supplier["evidence"]
        assert all(source["url"].startswith("https://") for source in supplier["sources"])
        assert all(0 <= evidence["source_index"] < len(supplier["sources"]) for evidence in supplier["evidence"])
