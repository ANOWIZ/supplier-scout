from __future__ import annotations

from datetime import date
from typing import Any
from urllib.parse import urlparse


SCORE_VERSION = "coffee-horeca-v2"


def _source_reliability(supplier: dict[str, Any]) -> int:
    sources = supplier.get("sources", [])
    if not sources:
        return 0
    website_host = (urlparse(supplier.get("website", "")).hostname or "").removeprefix("www.")
    if not website_host:
        return 0
    all_official = all(
        source.get("type") == "official"
        and (
            (source_host := (urlparse(source.get("url", "")).hostname or "").removeprefix("www."))
            == website_host
            or source_host.endswith(f".{website_host}")
        )
        for source in sources
    )
    return 15 if all_official else 8


def _freshness_points(verified_at: str, today: date) -> int:
    try:
        age_days = max(0, (today - date.fromisoformat(verified_at)).days)
    except (TypeError, ValueError):
        return 0
    if age_days <= 30:
        return 10
    if age_days <= 90:
        return 6
    if age_days <= 180:
        return 3
    return 0


def score_supplier(supplier: dict[str, Any], requested_kg: float = 10, today: date | None = None) -> dict[str, Any]:
    """Return an explainable, deterministic suitability score.

    Unknown values never receive the points reserved for a confirmed match.
    """
    min_kg = supplier.get("minimum_order", {}).get("kg")
    minimum_fit = min_kg is None or min_kg <= requested_kg
    today = today or date.today()

    breakdown = {
        "product_match": 30 if "Кофе в зернах" in supplier.get("products", []) else 0,
        "delivery_region": 25 if supplier.get("delivers_to_ekaterinburg") is True else 0,
        "minimum_fit": 15 if min_kg is not None and minimum_fit else (8 if min_kg is None else 0),
        "source_reliability": _source_reliability(supplier),
        "freshness": _freshness_points(supplier.get("verified_at", ""), today),
        "price_transparency": 5 if supplier.get("price", {}).get("amount") is not None else 0,
    }
    return {
        "total": sum(breakdown.values()),
        "version": SCORE_VERSION,
        "breakdown": breakdown,
    }
