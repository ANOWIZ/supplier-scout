from __future__ import annotations

from datetime import date
from typing import Any
from urllib.parse import urlparse


SCORE_VERSION = "horeca-v3"


def minimum_matches(supplier: dict[str, Any], category: str, requested_kg: float, requested_period: str) -> bool:
    minimum = supplier.get("offers", {}).get(category, {}).get("minimum_order", {})
    kg = minimum.get("kg")
    return (
        kg is not None
        and minimum.get("rub") is None
        and minimum.get("period") == requested_period
        and kg <= requested_kg
    )


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


def score_supplier(
    supplier: dict[str, Any], requested_kg: float = 10, today: date | None = None,
    *, category: str = "coffee-beans", region: str = "Екатеринбург", requested_period: str = "order",
) -> dict[str, Any]:
    """Return an explainable, deterministic suitability score.

    Unknown values never receive the points reserved for a confirmed match.
    """
    offer = supplier.get("offers", {}).get(category, {})
    today = today or date.today()

    breakdown = {
        "product_match": 30 if offer else 0,
        "delivery_region": 25 if supplier.get("delivery_regions", {}).get(region) is True else 0,
        "minimum_fit": 15 if minimum_matches(supplier, category, requested_kg, requested_period) else 0,
        "source_reliability": _source_reliability(supplier),
        "freshness": _freshness_points(supplier.get("verified_at", ""), today),
        "price_transparency": 5 if offer.get("price", {}).get("amount") is not None else 0,
    }
    return {
        "total": sum(breakdown.values()),
        "version": SCORE_VERSION,
        "breakdown": breakdown,
    }
