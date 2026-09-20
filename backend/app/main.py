from __future__ import annotations

from contextlib import asynccontextmanager
import os
from typing import Annotated

from fastapi import FastAPI, HTTPException, Query
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field

from .database import get_supplier, initialise_database, list_suppliers, load_snapshot
from .scoring import SCORE_VERSION, score_supplier


@asynccontextmanager
async def lifespan(_: FastAPI):
    initialise_database()
    yield


app = FastAPI(
    title="Supplier Scout API",
    version="1.0.0",
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


@app.get("/api/v1/health")
def health() -> dict[str, str]:
    return {"status": "ok", "snapshot": load_snapshot()["meta"]["verified_at"]}


@app.get("/api/v1/products")
def products() -> list[dict[str, str]]:
    return [{"id": "coffee-beans", "name": "Кофе в зернах", "unit": "кг"}]


@app.get("/api/v1/suppliers")
def suppliers(
    region: Annotated[str | None, Query(max_length=100)] = None,
    requested_kg: Annotated[float, Query(gt=0, le=100_000)] = 10,
    delivery_only: bool = False,
    price_published: bool = False,
    minimum_fit: bool = False,
) -> dict:
    items = list_suppliers()
    if region and region.casefold() not in {"екатеринбург", "свердловская область", "россия"}:
        items = []
    if delivery_only:
        items = [item for item in items if item.get("delivers_to_ekaterinburg") is True]
    if price_published:
        items = [item for item in items if item.get("price", {}).get("amount") is not None]
    if minimum_fit:
        items = [
            item
            for item in items
            if item.get("minimum_order", {}).get("kg") is not None
            and item["minimum_order"]["kg"] <= requested_kg
        ]

    enriched = [{**item, "score": score_supplier(item, requested_kg)} for item in items]
    enriched.sort(key=lambda item: (-item["score"]["total"], item["name"].casefold()))
    return {"items": enriched, "count": len(enriched), "mode": "api"}


@app.get("/api/v1/suppliers/{supplier_id}")
def supplier_detail(supplier_id: str) -> dict:
    item = get_supplier(supplier_id)
    if item is None:
        raise HTTPException(status_code=404, detail="Supplier not found")
    return {**item, "score": score_supplier(item)}


@app.post("/api/v1/compare")
def compare(request: CompareRequest) -> dict:
    unique_ids = list(dict.fromkeys(request.supplier_ids))
    items = [get_supplier(supplier_id) for supplier_id in unique_ids]
    if any(item is None for item in items):
        raise HTTPException(status_code=404, detail="One or more suppliers not found")
    ranked = [{**item, "score": score_supplier(item, request.requested_kg)} for item in items if item]
    ranked.sort(key=lambda item: (-item["score"]["total"], item["name"].casefold()))
    return {"items": ranked, "recommended_id": ranked[0]["id"], "score_version": SCORE_VERSION}
