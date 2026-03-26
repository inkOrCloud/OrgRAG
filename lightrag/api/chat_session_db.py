"""
Chat session database module for LightRAG API.

Uses Python built-in sqlite3 with asyncio.to_thread for async support.
Stores per-user, per-KB chat sessions with full message history.
"""

import sqlite3
import json
import asyncio
from datetime import datetime
from typing import Optional
from dataclasses import dataclass

from lightrag.utils import logger


# ── Data Model ───────────────────────────────────────────────────────────────

@dataclass
class ChatSession:
    id: str
    username: str
    kb_id: Optional[str]
    messages: list        # list of ChatMessage dicts (serialized as JSON)
    preview: str
    mode: str
    timestamp: int        # ms since epoch (matches JS Date.now())
    updated_at: str

    def to_dict(self) -> dict:
        return {
            "id": self.id,
            "kbId": self.kb_id,
            "messages": self.messages,
            "preview": self.preview,
            "mode": self.mode,
            "timestamp": self.timestamp,
        }


# ── Database Manager ──────────────────────────────────────────────────────────

class ChatSessionDB:
    """Async-compatible SQLite chat session database."""

    def __init__(self, db_path: str):
        self.db_path = db_path

    def _connect(self) -> sqlite3.Connection:
        conn = sqlite3.connect(self.db_path, check_same_thread=False)
        conn.row_factory = sqlite3.Row
        return conn

    def _init_schema(self):
        with self._connect() as conn:
            conn.execute("""
                CREATE TABLE IF NOT EXISTS chat_sessions (
                    id TEXT PRIMARY KEY,
                    username TEXT NOT NULL,
                    kb_id TEXT,
                    messages TEXT NOT NULL DEFAULT '[]',
                    preview TEXT NOT NULL DEFAULT '',
                    mode TEXT NOT NULL DEFAULT 'hybrid',
                    timestamp INTEGER NOT NULL,
                    updated_at TEXT NOT NULL
                )
            """)
            conn.execute(
                "CREATE INDEX IF NOT EXISTS idx_chat_username ON chat_sessions(username)"
            )
            conn.execute(
                "CREATE INDEX IF NOT EXISTS idx_chat_kb ON chat_sessions(username, kb_id)"
            )
            conn.commit()

    async def initialize(self):
        """Create schema (idempotent)."""
        await asyncio.to_thread(self._init_schema)
        logger.info(f"ChatSessionDB initialized at {self.db_path}")

    def _row_to_session(self, row: sqlite3.Row) -> "ChatSession":
        return ChatSession(
            id=row["id"],
            username=row["username"],
            kb_id=row["kb_id"],
            messages=json.loads(row["messages"]),
            preview=row["preview"],
            mode=row["mode"],
            timestamp=row["timestamp"],
            updated_at=row["updated_at"],
        )

    # ── List ──────────────────────────────────────────────────────────────────

    def _do_list(self, username: str, kb_id: Optional[str]) -> list:
        with self._connect() as conn:
            if kb_id is not None:
                rows = conn.execute(
                    "SELECT * FROM chat_sessions WHERE username=? AND kb_id=?"
                    " ORDER BY timestamp DESC LIMIT 100",
                    (username, kb_id),
                ).fetchall()
            else:
                rows = conn.execute(
                    "SELECT * FROM chat_sessions WHERE username=?"
                    " ORDER BY timestamp DESC LIMIT 100",
                    (username,),
                ).fetchall()
            return [self._row_to_session(r) for r in rows]

    async def list_sessions(self, username: str, kb_id: Optional[str] = None) -> list:
        return await asyncio.to_thread(self._do_list, username, kb_id)

    # ── Upsert ────────────────────────────────────────────────────────────────

    def _do_upsert(self, session_id: str, username: str, kb_id: Optional[str],
                   messages: list, preview: str, mode: str, timestamp: int) -> "ChatSession":
        now = datetime.utcnow().isoformat()
        messages_json = json.dumps(messages, ensure_ascii=False)
        with self._connect() as conn:
            conn.execute(
                """
                INSERT INTO chat_sessions
                    (id, username, kb_id, messages, preview, mode, timestamp, updated_at)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?)
                ON CONFLICT(id) DO UPDATE SET
                    messages=excluded.messages, preview=excluded.preview,
                    mode=excluded.mode, timestamp=excluded.timestamp,
                    updated_at=excluded.updated_at
                """,
                (session_id, username, kb_id, messages_json, preview, mode, timestamp, now),
            )
            conn.commit()
        return ChatSession(id=session_id, username=username, kb_id=kb_id,
                           messages=messages, preview=preview, mode=mode,
                           timestamp=timestamp, updated_at=now)

    async def upsert_session(self, session_id: str, username: str, kb_id: Optional[str],
                              messages: list, preview: str, mode: str, timestamp: int) -> "ChatSession":
        return await asyncio.to_thread(
            self._do_upsert, session_id, username, kb_id, messages, preview, mode, timestamp
        )


    # ── Delete ────────────────────────────────────────────────────────────────

    def _do_delete(self, session_id: str, username: str):
        with self._connect() as conn:
            conn.execute(
                "DELETE FROM chat_sessions WHERE id=? AND username=?",
                (session_id, username),
            )
            conn.commit()

    async def delete_session(self, session_id: str, username: str):
        await asyncio.to_thread(self._do_delete, session_id, username)

    # ── Clear ─────────────────────────────────────────────────────────────────

    def _do_clear(self, username: str, kb_id: Optional[str]):
        with self._connect() as conn:
            if kb_id is not None:
                conn.execute(
                    "DELETE FROM chat_sessions WHERE username=? AND kb_id=?",
                    (username, kb_id),
                )
            else:
                conn.execute("DELETE FROM chat_sessions WHERE username=?", (username,))
            conn.commit()

    async def clear_sessions(self, username: str, kb_id: Optional[str] = None):
        await asyncio.to_thread(self._do_clear, username, kb_id)


# ── Singleton (initialized in lightrag_server lifespan) ──────────────────────

_chat_db: Optional[ChatSessionDB] = None


def get_chat_db() -> ChatSessionDB:
    if _chat_db is None:
        raise RuntimeError("ChatSessionDB not initialized. Call init_chat_db() first.")
    return _chat_db


def init_chat_db(db_path: str) -> ChatSessionDB:
    global _chat_db
    _chat_db = ChatSessionDB(db_path)
    return _chat_db

