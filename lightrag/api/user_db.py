"""
User database module for LightRAG API.

Uses Python built-in sqlite3 with asyncio.to_thread for async support.
No extra dependencies required.
"""

import sqlite3
import uuid
import asyncio
from datetime import datetime
from typing import Optional
from dataclasses import dataclass, field

from lightrag.utils import logger
from .passwords import hash_password, verify_password


# ── Data Model ──────────────────────────────────────────────────────────────

@dataclass
class User:
    id: str
    username: str
    role: str  # admin | user
    is_active: bool
    created_at: str
    updated_at: str
    hashed_password: str = field(repr=False)
    email: str = ""
    avatar_url: str = ""

    def to_dict(self, include_sensitive: bool = False) -> dict:
        d = {
            "id": self.id,
            "username": self.username,
            "email": self.email,
            "avatar_url": self.avatar_url,
            "role": self.role,
            "is_active": self.is_active,
            "created_at": self.created_at,
            "updated_at": self.updated_at,
        }
        if include_sensitive:
            d["hashed_password"] = self.hashed_password
        return d


# ── Database Manager ─────────────────────────────────────────────────────────

class UserDB:
    """Async-compatible SQLite user database (uses asyncio.to_thread internally)."""

    def __init__(self, db_path: str):
        self.db_path = db_path

    def _connect(self) -> sqlite3.Connection:
        conn = sqlite3.connect(self.db_path, check_same_thread=False)
        conn.row_factory = sqlite3.Row
        return conn

    def _init_schema(self):
        with self._connect() as conn:
            conn.execute("""
                CREATE TABLE IF NOT EXISTS users (
                    id TEXT PRIMARY KEY,
                    username TEXT UNIQUE NOT NULL,
                    email TEXT NOT NULL DEFAULT '',
                    hashed_password TEXT NOT NULL,
                    role TEXT NOT NULL DEFAULT 'user',
                    is_active INTEGER NOT NULL DEFAULT 1,
                    created_at TEXT NOT NULL,
                    updated_at TEXT NOT NULL
                )
            """)
            conn.execute("CREATE UNIQUE INDEX IF NOT EXISTS idx_users_username ON users(username)")
            # Migration: add avatar_url column for existing databases
            try:
                conn.execute("ALTER TABLE users ADD COLUMN avatar_url TEXT NOT NULL DEFAULT ''")
            except Exception:
                pass  # Column already exists
            conn.commit()

    def _row_to_user(self, row: sqlite3.Row) -> User:
        keys = row.keys()
        return User(
            id=row["id"],
            username=row["username"],
            email=row["email"],
            hashed_password=row["hashed_password"],
            role=row["role"],
            is_active=bool(row["is_active"]),
            created_at=row["created_at"],
            updated_at=row["updated_at"],
            avatar_url=row["avatar_url"] if "avatar_url" in keys else "",
        )

    async def initialize(self):
        """Create schema (idempotent)."""
        await asyncio.to_thread(self._init_schema)
        logger.info(f"UserDB initialized at {self.db_path}")

    async def ensure_default_admin(self):
        """
        Create a default admin account (admin/admin) if no admin user exists in the DB.
        This is called at startup to guarantee at least one admin is always available.
        """
        def _has_admin() -> bool:
            with self._connect() as conn:
                row = conn.execute(
                    "SELECT COUNT(*) FROM users WHERE role='admin'"
                ).fetchone()
                return row[0] > 0

        has_admin = await asyncio.to_thread(_has_admin)
        if not has_admin:
            await self.create_user(username="admin", password="admin", role="admin")
            logger.info(
                "UserDB: no admin account found – created default admin/admin. "
                "Please change the password immediately."
            )

    # ── CRUD ─────────────────────────────────────────────────────────────────

    def _do_count(self) -> int:
        with self._connect() as conn:
            row = conn.execute("SELECT COUNT(*) FROM users").fetchone()
            return row[0]

    async def count_users(self) -> int:
        return await asyncio.to_thread(self._do_count)

    def _do_create(self, user_id, username, email, hashed, role, now) -> User:
        with self._connect() as conn:
            conn.execute(
                "INSERT INTO users (id,username,email,hashed_password,role,is_active,created_at,updated_at) "
                "VALUES (?,?,?,?,?,1,?,?)",
                (user_id, username, email, hashed, role, now, now),
            )
            conn.commit()
        return User(id=user_id, username=username, email=email, hashed_password=hashed,
                    role=role, is_active=True, created_at=now, updated_at=now)

    async def create_user(self, username: str, password: str, role: str = "user",
                          email: str = "") -> User:
        user_id = str(uuid.uuid4())
        hashed = hash_password(password)
        now = datetime.utcnow().isoformat()
        return await asyncio.to_thread(self._do_create, user_id, username, email, hashed, role, now)

    def _do_get_by_id(self, user_id: str) -> Optional[User]:
        with self._connect() as conn:
            row = conn.execute("SELECT * FROM users WHERE id=?", (user_id,)).fetchone()
            return self._row_to_user(row) if row else None

    async def get_user_by_id(self, user_id: str) -> Optional[User]:
        return await asyncio.to_thread(self._do_get_by_id, user_id)

    def _do_get_by_username(self, username: str) -> Optional[User]:
        with self._connect() as conn:
            row = conn.execute("SELECT * FROM users WHERE username=?", (username,)).fetchone()
            return self._row_to_user(row) if row else None

    async def get_user_by_username(self, username: str) -> Optional[User]:
        return await asyncio.to_thread(self._do_get_by_username, username)

    def _do_list(self) -> list:
        with self._connect() as conn:
            rows = conn.execute("SELECT * FROM users ORDER BY created_at ASC").fetchall()
            return [self._row_to_user(r) for r in rows]

    async def list_users(self) -> list[User]:
        return await asyncio.to_thread(self._do_list)

    def _do_update(self, user_id: str, fields: dict) -> Optional[User]:
        now = datetime.utcnow().isoformat()
        fields["updated_at"] = now
        sets = ", ".join(f"{k}=?" for k in fields)
        vals = list(fields.values()) + [user_id]
        with self._connect() as conn:
            conn.execute(f"UPDATE users SET {sets} WHERE id=?", vals)
            conn.commit()
        return self._do_get_by_id(user_id)

    async def update_user(self, user_id: str, **kwargs) -> Optional[User]:
        """Update user fields. Use password= to update password (will be hashed)."""
        fields = {}
        if "password" in kwargs:
            fields["hashed_password"] = hash_password(kwargs.pop("password"))
        for k in ("username", "email", "role", "is_active", "avatar_url"):
            if k in kwargs:
                fields[k] = kwargs[k]
        if not fields:
            return await self.get_user_by_id(user_id)
        return await asyncio.to_thread(self._do_update, user_id, fields)

    def _do_delete(self, user_id: str):
        with self._connect() as conn:
            conn.execute("DELETE FROM users WHERE id=?", (user_id,))
            conn.commit()

    async def delete_user(self, user_id: str):
        await asyncio.to_thread(self._do_delete, user_id)

    async def verify_password(self, username: str, plain_password: str) -> Optional[User]:
        """Return User if credentials valid, else None."""
        user = await self.get_user_by_username(username)
        if user and user.is_active and verify_password(plain_password, user.hashed_password):
            return user
        return None


# ── Singleton (initialized in lightrag_server lifespan) ─────────────────────

_user_db: Optional[UserDB] = None


def get_user_db() -> UserDB:
    if _user_db is None:
        raise RuntimeError("UserDB not initialized. Call init_user_db() first.")
    return _user_db


def init_user_db(db_path: str) -> UserDB:
    global _user_db
    _user_db = UserDB(db_path)
    return _user_db

