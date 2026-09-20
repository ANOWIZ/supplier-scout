from __future__ import annotations

import json
import sqlite3
from pathlib import Path
from typing import Any

ROOT = Path(__file__).resolve().parents[2]
DATA_FILE = ROOT / "data" / "suppliers.json"
DATABASE_FILE = Path(__file__).resolve().parent / "supplier_scout.sqlite3"


def load_snapshot() -> dict[str, Any]:
    with DATA_FILE.open(encoding="utf-8") as handle:
        return json.load(handle)


def initialise_database() -> None:
    payload = load_snapshot()
    connection = sqlite3.connect(DATABASE_FILE)
    try:
        connection.execute(
            """
            CREATE TABLE IF NOT EXISTS suppliers (
                id TEXT PRIMARY KEY,
                name TEXT NOT NULL,
                payload TEXT NOT NULL,
                verified_at TEXT NOT NULL
            )
            """
        )
        connection.execute("DELETE FROM suppliers")
        connection.executemany(
            "INSERT INTO suppliers (id, name, payload, verified_at) VALUES (?, ?, ?, ?)",
            [
                (
                    supplier["id"],
                    supplier["name"],
                    json.dumps(supplier, ensure_ascii=False),
                    supplier["verified_at"],
                )
                for supplier in payload["suppliers"]
            ],
        )
        connection.commit()
    finally:
        connection.close()


def list_suppliers() -> list[dict[str, Any]]:
    connection = sqlite3.connect(DATABASE_FILE)
    try:
        rows = connection.execute("SELECT payload FROM suppliers ORDER BY name COLLATE NOCASE").fetchall()
        return [json.loads(row[0]) for row in rows]
    finally:
        connection.close()


def get_supplier(supplier_id: str) -> dict[str, Any] | None:
    connection = sqlite3.connect(DATABASE_FILE)
    try:
        row = connection.execute("SELECT payload FROM suppliers WHERE id = ?", (supplier_id,)).fetchone()
        return json.loads(row[0]) if row else None
    finally:
        connection.close()
