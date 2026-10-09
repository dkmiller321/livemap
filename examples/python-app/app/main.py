"""A small FastAPI app with a SQLite lookup and an LLM call. It knows nothing about tracing:
the hookup is the launcher and environment variables only."""

import os
import sqlite3
import threading

from fastapi import FastAPI, HTTPException
from openai import OpenAI

MODEL = os.environ.get("LLM_MODEL") or "mock-model"

llm = OpenAI(
    base_url=os.environ.get("LLM_BASE_URL") or "http://127.0.0.1:4599/v1",
    api_key=os.environ.get("LLM_API_KEY") or "mock-key",
    max_retries=0,
)

db = sqlite3.connect(":memory:", check_same_thread=False)
db_lock = threading.Lock()
with db_lock:
    setup = db.cursor()
    setup.execute("CREATE TABLE orders (id INTEGER PRIMARY KEY, status TEXT NOT NULL)")
    setup.execute("INSERT INTO orders (id, status) VALUES (?, ?)", (1042, "shipped"))
    db.commit()

app = FastAPI()


@app.get("/healthz")
def healthz():
    return {"status": "ok"}


@app.get("/orders/{order_id}")
def get_order(order_id: int):
    with db_lock:
        cursor = db.cursor()
        cursor.execute("SELECT id, status FROM orders WHERE id = ?", (order_id,))
        row = cursor.fetchone()
    if row is None:
        raise HTTPException(status_code=404, detail="order not found")
    completion = llm.chat.completions.create(
        model=MODEL,
        messages=[{"role": "user", "content": f"Give the order status for order {order_id} in one sentence."}],
    )
    return {"order": row[0], "status": row[1], "summary": completion.choices[0].message.content}
