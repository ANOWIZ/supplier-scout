from __future__ import annotations

from contextlib import asynccontextmanager
import os
from typing import Annotated, Literal

from fastapi import FastAPI, HTTPException, Query
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field

from .database import get_supplier, initialise_database, list_suppliers, load_snapshot
from .scoring import SCORE_VERSION, minimum_matches, score_supplier

Category = Literal["coffee-beans", "tea"]
Region = Literal["Екатеринбург", "Москва"]
Period = Literal["order", "month"]


@asynccontextmanager
async def lifespan(_: FastAPI):
    initialise_database()
    yield


app = FastAPI(
    title="Supplier Scout API",
    version="2.0.0",
    description="Read-only API for a sourced supplier snapshot.",
    lifespan=lifespan,
)
allowed_origins = [
    origin.strip()
    for origin in os.getenv(
        "SUPPLIER_SCOUT_CORS_ORIGINS",
        "http://localhost:5173,http://127.0.0.1:5173,https://anowiz.github.io",
    ).split(",")
    if origin.strip()
]

app.add_middleware(
    CORSMiddleware,
    allow_origins=allowed_origins,
    allow_credentials=False,
    allow_methods=["GET", "POST"],
    allow_headers=["*"],
)


class CompareRequest(BaseModel):
    supplier_ids: list[str] = Field(min_length=1, max_length=3)
    requested_kg: float = Field(default=10, gt=0, le=100_000)
    category: Category = "coffee-beans"
    region: Region = "Екатеринбург"
    requested_period: Period = "order"


def ranked_items(items: list[dict], category: Category, region: Region, requested_kg: float, requested_period: Period) -> list[dict]:
    enriched = [
        {**item, "score": score_supplier(item, requested_kg, category=category, region=region, requested_period=requested_period)}
        for item in items
        if category in item.get("offers", {}) and item.get("delivery_regions", {}).get(region) is not False
    ]
    enriched.sort(key=lambda item: (-item["score"]["total"], item["id"]))
    return enriched


@app.get("/api/v1/catalog")
def catalog() -> dict:
    """Complete canonical catalog for client-side category and region switching."""
    return load_snapshot()


@app.get("/api/v1/health")
def health() -> dict[str, str]:
    return {"status": "ok", "snapshot": load_snapshot()["meta"]["verified_at"]}


@app.get("/api/v1/products")
def products() -> list[dict[str, str]]:
    return load_snapshot()["meta"]["categories"]


@app.get("/api/v1/suppliers")
def suppliers(
    category: Category = "coffee-beans",
    region: Region = "Екатеринбург",
    requested_kg: Annotated[float, Query(gt=0, le=100_000)] = 10,
    requested_period: Period = "order",
    delivery_only: bool = False,
    price_published: bool = False,
    minimum_fit: bool = False,
) -> dict:
    items = list_suppliers()
    if delivery_only:
        items = [item for item in items if item.get("delivery_regions", {}).get(region) is True]
    if price_published:
        items = [item for item in items if item.get("offers", {}).get(category, {}).get("price", {}).get("amount") is not None]
    if minimum_fit:
        items = [
            item
            for item in items
            if minimum_matches(item, category, requested_kg, requested_period)
        ]

    enriched = ranked_items(items, category, region, requested_kg, requested_period)
    return {"items": enriched, "count": len(enriched), "mode": "api"}


@app.get("/api/v1/suppliers/{supplier_id}")
def supplier_detail(
    supplier_id: str, category: Category = "coffee-beans", region: Region = "Екатеринбург",
    requested_kg: Annotated[float, Query(gt=0, le=100_000)] = 10, requested_period: Period = "order",
) -> dict:
    item = get_supplier(supplier_id)
    if item is None:
        raise HTTPException(status_code=404, detail="Supplier not found")
    ranked = ranked_items([item], category, region, requested_kg, requested_period)
    if not ranked:
        raise HTTPException(status_code=422, detail="Supplier does not support the selected category or region")
    return ranked[0]


@app.post("/api/v1/compare")
def compare(request: CompareRequest) -> dict:
    unique_ids = list(dict.fromkeys(request.supplier_ids))
    items = [get_supplier(supplier_id) for supplier_id in unique_ids]
    if any(item is None for item in items):
        raise HTTPException(status_code=404, detail="One or more suppliers not found")
    ranked = ranked_items([item for item in items if item], request.category, request.region, request.requested_kg, request.requested_period)
    if len(ranked) != len(unique_ids):
        raise HTTPException(status_code=422, detail="Supplier does not support the selected category or region")
    leaders = [item["id"] for item in ranked if item["score"]["total"] == ranked[0]["score"]["total"]]
    return {"items": ranked, "leading_ids": leaders, "score_version": SCORE_VERSION}
