"""
Knowledge Base metadata database for LightRAG multi-KB support.

Uses the same SQLite file as user_db (lightrag_users.db).
No extra dependencies – asyncio.to_thread wraps sqlite3.
"""

import json
import sqlite3
import uuid
import asyncio
import re
from datetime import datetime
from typing import Optional
from dataclasses import dataclass, field

from lightrag.utils import logger


# ── Data Model ───────────────────────────────────────────────────────────────

@dataclass
class KnowledgeBase:
    id: str
    name: str
    workspace: str      # storage isolation key (a-z, A-Z, 0-9, _)
    description: str
    owner_username: str
    is_active: bool
    created_at: str
    updated_at: str
    settings: dict = field(default_factory=dict)  # Phase 3: per-KB query settings
    org_id: Optional[str] = None                  # Phase B: owning organization

    def to_dict(self) -> dict:
        return {
            "id": self.id,
            "name": self.name,
            "workspace": self.workspace,
            "description": self.description,
            "owner_username": self.owner_username,
            "is_active": self.is_active,
            "created_at": self.created_at,
            "updated_at": self.updated_at,
            "settings": self.settings,
            "org_id": self.org_id,
        }


@dataclass
class Organization:
    id: str
    name: str
    parent_id: Optional[str]
    description: str
    created_at: str
    updated_at: str
    member_count: int = 0
    children: list = field(default_factory=list)

    def to_dict(self, include_children: bool = True) -> dict:
        d = {
            "id": self.id,
            "name": self.name,
            "parent_id": self.parent_id,
            "description": self.description,
            "created_at": self.created_at,
            "updated_at": self.updated_at,
            "member_count": self.member_count,
        }
        if include_children:
            d["children"] = [c.to_dict() for c in self.children]
        return d


@dataclass
class OrgMember:
    id: str
    org_id: str
    username: str
    role: str  # 'admin' | 'member'
    joined_at: str

    def to_dict(self) -> dict:
        return {
            "id": self.id,
            "org_id": self.org_id,
            "username": self.username,
            "role": self.role,
            "joined_at": self.joined_at,
        }


def _make_workspace(name: str, kb_id: str) -> str:
    """
    Derive a safe workspace slug from KB name + UUID suffix.
    Constraints: a-z, A-Z, 0-9, _ only (no hyphens).
    """
    slug = re.sub(r"[^a-zA-Z0-9]", "_", name.strip())[:20].strip("_").lower()
    suffix = kb_id.replace("-", "")[:8]
    return f"{slug}_{suffix}" if slug else f"kb_{suffix}"


# ── Database Manager ─────────────────────────────────────────────────────────

class KBDatabase:
    """Async-compatible SQLite knowledge-base metadata store."""

    def __init__(self, db_path: str):
        self.db_path = db_path

    def _connect(self) -> sqlite3.Connection:
        conn = sqlite3.connect(self.db_path, check_same_thread=False)
        conn.row_factory = sqlite3.Row
        return conn

    def _init_schema(self):
        with self._connect() as conn:
            conn.execute("""
                CREATE TABLE IF NOT EXISTS knowledge_bases (
                    id            TEXT PRIMARY KEY,
                    name          TEXT UNIQUE NOT NULL,
                    workspace     TEXT UNIQUE NOT NULL,
                    description   TEXT NOT NULL DEFAULT '',
                    owner_username TEXT NOT NULL DEFAULT 'system',
                    is_active     INTEGER NOT NULL DEFAULT 1,
                    created_at    TEXT NOT NULL,
                    updated_at    TEXT NOT NULL
                )
            """)
            conn.execute("CREATE UNIQUE INDEX IF NOT EXISTS idx_kb_name ON knowledge_bases(name)")
            conn.execute("CREATE UNIQUE INDEX IF NOT EXISTS idx_kb_workspace ON knowledge_bases(workspace)")
            # Phase 3: per-KB settings column (idempotent ALTER TABLE)
            try:
                conn.execute("ALTER TABLE knowledge_bases ADD COLUMN settings TEXT NOT NULL DEFAULT '{}'")
                conn.commit()
            except sqlite3.OperationalError:
                pass  # Column already exists
            # Phase 2: per-user KB access permissions
            conn.execute("""
                CREATE TABLE IF NOT EXISTS kb_user_permissions (
                    id         TEXT PRIMARY KEY,
                    kb_id      TEXT NOT NULL,
                    username   TEXT NOT NULL,
                    granted_at TEXT NOT NULL,
                    FOREIGN KEY (kb_id) REFERENCES knowledge_bases(id) ON DELETE CASCADE,
                    UNIQUE(kb_id, username)
                )
            """)
            conn.execute("CREATE INDEX IF NOT EXISTS idx_kbperm_kb   ON kb_user_permissions(kb_id)")
            conn.execute("CREATE INDEX IF NOT EXISTS idx_kbperm_user ON kb_user_permissions(username)")
            # Phase A: Organization tree
            conn.execute("""
                CREATE TABLE IF NOT EXISTS organizations (
                    id          TEXT PRIMARY KEY,
                    name        TEXT NOT NULL,
                    parent_id   TEXT REFERENCES organizations(id) ON DELETE RESTRICT,
                    description TEXT NOT NULL DEFAULT '',
                    created_at  TEXT NOT NULL,
                    updated_at  TEXT NOT NULL
                )
            """)
            conn.execute("CREATE INDEX IF NOT EXISTS idx_org_parent ON organizations(parent_id)")
            # Phase A: Org members (UNIQUE username enforces single-org rule)
            conn.execute("""
                CREATE TABLE IF NOT EXISTS org_members (
                    id        TEXT PRIMARY KEY,
                    org_id    TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
                    username  TEXT NOT NULL UNIQUE,
                    role      TEXT NOT NULL DEFAULT 'member',
                    joined_at TEXT NOT NULL
                )
            """)
            conn.execute("CREATE INDEX IF NOT EXISTS idx_orgmem_org  ON org_members(org_id)")
            conn.execute("CREATE INDEX IF NOT EXISTS idx_orgmem_user ON org_members(username)")
            # One-time cleanup: remove mass-migration kb_user_permissions entries
            # (keep only rows where username == kb owner, i.e. explicit creator grants)
            conn.execute("""
                DELETE FROM kb_user_permissions
                WHERE username != (
                    SELECT owner_username FROM knowledge_bases WHERE id = kb_user_permissions.kb_id
                )
            """)
            # Phase B: add org_id to knowledge_bases
            try:
                conn.execute("ALTER TABLE knowledge_bases ADD COLUMN org_id TEXT REFERENCES organizations(id) ON DELETE SET NULL")
            except Exception:
                pass  # column already exists
            # Auto-migrate: assign existing KBs to their creator's org
            conn.execute("""
                UPDATE knowledge_bases
                SET org_id = (
                    SELECT org_id FROM org_members WHERE username = knowledge_bases.owner_username
                )
                WHERE org_id IS NULL
            """)
            # Phase C: KB operation permissions (independent of org role)
            conn.execute("""
                CREATE TABLE IF NOT EXISTS org_kb_permissions (
                    id          TEXT PRIMARY KEY,
                    username    TEXT NOT NULL,
                    permission  TEXT NOT NULL,   -- 'read' | 'write'
                    granted_by  TEXT,
                    granted_at  TEXT NOT NULL,
                    UNIQUE(username, permission)
                )
            """)
            conn.execute("CREATE INDEX IF NOT EXISTS idx_kboperm_user ON org_kb_permissions(username)")
            conn.commit()

    def _row_to_kb(self, row: sqlite3.Row) -> KnowledgeBase:
        keys = row.keys()
        raw_settings = row["settings"] if "settings" in keys else "{}"
        try:
            settings = json.loads(raw_settings or "{}")
        except (json.JSONDecodeError, TypeError):
            settings = {}
        return KnowledgeBase(
            id=row["id"], name=row["name"], workspace=row["workspace"],
            description=row["description"], owner_username=row["owner_username"],
            is_active=bool(row["is_active"]),
            created_at=row["created_at"], updated_at=row["updated_at"],
            settings=settings,
            org_id=row["org_id"] if "org_id" in keys else None,
        )

    async def initialize(self):
        await asyncio.to_thread(self._init_schema)
        logger.info("KBDatabase initialized")

    # ── CRUD ─────────────────────────────────────────────────────────────────

    def _do_count(self) -> int:
        with self._connect() as conn:
            return conn.execute("SELECT COUNT(*) FROM knowledge_bases").fetchone()[0]

    async def count_kbs(self) -> int:
        return await asyncio.to_thread(self._do_count)

    def _do_create(self, kb_id, name, workspace, description, owner_username, now, org_id=None):
        with self._connect() as conn:
            conn.execute(
                "INSERT INTO knowledge_bases (id,name,workspace,description,owner_username,is_active,created_at,updated_at,org_id) "
                "VALUES (?,?,?,?,?,1,?,?,?)",
                (kb_id, name, workspace, description, owner_username, now, now, org_id),
            )
            conn.commit()
        return KnowledgeBase(id=kb_id, name=name, workspace=workspace,
                             description=description, owner_username=owner_username,
                             is_active=True, created_at=now, updated_at=now, org_id=org_id)

    async def create_kb(self, name: str, description: str = "",
                        owner_username: str = "system",
                        workspace: Optional[str] = None,
                        org_id: Optional[str] = None) -> KnowledgeBase:
        kb_id = str(uuid.uuid4())
        ws = workspace if workspace is not None else _make_workspace(name, kb_id)
        now = datetime.utcnow().isoformat()
        return await asyncio.to_thread(self._do_create, kb_id, name, ws, description, owner_username, now, org_id)

    def _do_list(self) -> list:
        with self._connect() as conn:
            rows = conn.execute("SELECT * FROM knowledge_bases ORDER BY created_at ASC").fetchall()
            return [self._row_to_kb(r) for r in rows]

    async def list_kbs(self) -> list[KnowledgeBase]:
        return await asyncio.to_thread(self._do_list)

    def _do_get_by_id(self, kb_id: str) -> Optional[KnowledgeBase]:
        with self._connect() as conn:
            row = conn.execute("SELECT * FROM knowledge_bases WHERE id=?", (kb_id,)).fetchone()
            return self._row_to_kb(row) if row else None

    async def get_kb_by_id(self, kb_id: str) -> Optional[KnowledgeBase]:
        return await asyncio.to_thread(self._do_get_by_id, kb_id)

    def _do_get_by_name(self, name: str) -> Optional[KnowledgeBase]:
        with self._connect() as conn:
            row = conn.execute("SELECT * FROM knowledge_bases WHERE name=?", (name,)).fetchone()
            return self._row_to_kb(row) if row else None

    async def get_kb_by_name(self, name: str) -> Optional[KnowledgeBase]:
        return await asyncio.to_thread(self._do_get_by_name, name)

    def _do_update(self, kb_id: str, fields: dict) -> Optional[KnowledgeBase]:
        now = datetime.utcnow().isoformat()
        fields["updated_at"] = now
        sets = ", ".join(f"{k}=?" for k in fields)
        vals = list(fields.values()) + [kb_id]
        with self._connect() as conn:
            conn.execute(f"UPDATE knowledge_bases SET {sets} WHERE id=?", vals)
            conn.commit()
        return self._do_get_by_id(kb_id)

    async def update_kb(self, kb_id: str, **kwargs) -> Optional[KnowledgeBase]:
        fields = {k: v for k, v in kwargs.items() if k in ("name", "description", "is_active")}
        if not fields:
            return await self.get_kb_by_id(kb_id)
        return await asyncio.to_thread(self._do_update, kb_id, fields)

    def _do_delete(self, kb_id: str):
        with self._connect() as conn:
            conn.execute("DELETE FROM knowledge_bases WHERE id=?", (kb_id,))
            conn.commit()

    async def delete_kb(self, kb_id: str):
        await asyncio.to_thread(self._do_delete, kb_id)

    # ── Settings CRUD (Phase 3) ───────────────────────────────────────────────

    def _do_get_settings(self, kb_id: str) -> dict:
        with self._connect() as conn:
            row = conn.execute(
                "SELECT settings FROM knowledge_bases WHERE id=?", (kb_id,)
            ).fetchone()
            if row is None:
                return {}
            try:
                return json.loads(row["settings"] or "{}")
            except (json.JSONDecodeError, TypeError):
                return {}

    async def get_kb_settings(self, kb_id: str) -> dict:
        return await asyncio.to_thread(self._do_get_settings, kb_id)

    def _do_update_settings(self, kb_id: str, settings: dict) -> Optional["KnowledgeBase"]:
        now = datetime.utcnow().isoformat()
        with self._connect() as conn:
            conn.execute(
                "UPDATE knowledge_bases SET settings=?, updated_at=? WHERE id=?",
                (json.dumps(settings), now, kb_id),
            )
            conn.commit()
        return self._do_get_by_id(kb_id)

    async def update_kb_settings(self, kb_id: str, settings: dict) -> Optional["KnowledgeBase"]:
        return await asyncio.to_thread(self._do_update_settings, kb_id, settings)

    # ── Permission CRUD ───────────────────────────────────────────────────────

    def _do_grant(self, kb_id: str, username: str) -> bool:
        """Insert permission row. Returns True if newly inserted, False if already existed."""
        now = datetime.utcnow().isoformat()
        perm_id = str(uuid.uuid4())
        with self._connect() as conn:
            try:
                conn.execute(
                    "INSERT INTO kb_user_permissions (id, kb_id, username, granted_at) VALUES (?,?,?,?)",
                    (perm_id, kb_id, username, now),
                )
                conn.commit()
                return True
            except sqlite3.IntegrityError:
                return False  # already exists

    async def grant_kb_access(self, kb_id: str, username: str) -> bool:
        return await asyncio.to_thread(self._do_grant, kb_id, username)

    def _do_revoke(self, kb_id: str, username: str) -> bool:
        with self._connect() as conn:
            cur = conn.execute(
                "DELETE FROM kb_user_permissions WHERE kb_id=? AND username=?",
                (kb_id, username),
            )
            conn.commit()
            return cur.rowcount > 0

    async def revoke_kb_access(self, kb_id: str, username: str) -> bool:
        return await asyncio.to_thread(self._do_revoke, kb_id, username)

    def _do_has_access(self, kb_id: str, username: str, require_write: bool = False) -> bool:
        with self._connect() as conn:
            kb_row = conn.execute(
                "SELECT org_id, owner_username FROM knowledge_bases WHERE id=?", (kb_id,)
            ).fetchone()
            if not kb_row:
                return False
            if kb_row["org_id"]:
                # KB belongs to an org → org-based check only (Phase C)
                accessible = self._do_get_accessible_org_ids(username)
                kb_org_id = kb_row["org_id"]
                if require_write:
                    return kb_org_id in accessible["write"]
                return kb_org_id in accessible["read"] or kb_org_id in accessible["write"]
            else:
                # Legacy KB (no org) → only the owner has write access;
                # explicit kb_user_permissions grants read access.
                if require_write:
                    return kb_row["owner_username"] == username
                row = conn.execute(
                    "SELECT 1 FROM kb_user_permissions WHERE kb_id=? AND username=?",
                    (kb_id, username),
                ).fetchone()
                return row is not None

    async def has_kb_access(self, kb_id: str, username: str) -> bool:
        return await asyncio.to_thread(self._do_has_access, kb_id, username)

    async def has_kb_write_access(self, kb_id: str, username: str) -> bool:
        """Check whether *username* has write (upload/delete/modify) access to *kb_id*."""
        return await asyncio.to_thread(self._do_has_access, kb_id, username, require_write=True)

    def _do_list_members(self, kb_id: str) -> list:
        with self._connect() as conn:
            rows = conn.execute(
                "SELECT username, granted_at FROM kb_user_permissions WHERE kb_id=? ORDER BY granted_at ASC",
                (kb_id,),
            ).fetchall()
            return [{"username": r["username"], "granted_at": r["granted_at"]} for r in rows]

    async def list_kb_members(self, kb_id: str) -> list[dict]:
        return await asyncio.to_thread(self._do_list_members, kb_id)

    def _do_list_for_user(self, username: str) -> list:
        """Legacy fallback: only returns KBs with no org (org_id IS NULL)."""
        with self._connect() as conn:
            rows = conn.execute(
                """
                SELECT kb.* FROM knowledge_bases kb
                JOIN kb_user_permissions p ON kb.id = p.kb_id
                WHERE p.username = ? AND kb.org_id IS NULL
                ORDER BY kb.created_at ASC
                """,
                (username,),
            ).fetchall()
            return [self._row_to_kb(r) for r in rows]

    async def list_kbs_for_user(self, username: str) -> list[KnowledgeBase]:
        """Return KBs the user has been explicitly granted access to (legacy)."""
        return await asyncio.to_thread(self._do_list_for_user, username)

    def _do_list_by_org(self, org_id: str) -> list:
        with self._connect() as conn:
            rows = conn.execute(
                "SELECT * FROM knowledge_bases WHERE org_id=? ORDER BY created_at ASC",
                (org_id,),
            ).fetchall()
            return [self._row_to_kb(r) for r in rows]

    async def list_kbs_by_org(self, org_id: str) -> list[KnowledgeBase]:
        """Return all KBs belonging to a specific organization."""
        return await asyncio.to_thread(self._do_list_by_org, org_id)

    def _do_grant_all(self, username: str):
        """Grant user access to every existing KB (used for migration and new user setup)."""
        now = datetime.utcnow().isoformat()
        with self._connect() as conn:
            kb_ids = [r[0] for r in conn.execute("SELECT id FROM knowledge_bases").fetchall()]
            for kb_id in kb_ids:
                perm_id = str(uuid.uuid4())
                try:
                    conn.execute(
                        "INSERT INTO kb_user_permissions (id, kb_id, username, granted_at) VALUES (?,?,?,?)",
                        (perm_id, kb_id, username, now),
                    )
                except sqlite3.IntegrityError:
                    pass  # already granted
            conn.commit()

    async def grant_user_all_kbs(self, username: str):
        """Grant a user access to all existing KBs."""
        await asyncio.to_thread(self._do_grant_all, username)

    def _do_migrate_all(self):
        """One-time Phase 2 migration: grant every existing user access to every existing KB."""
        with self._connect() as conn:
            usernames = [r[0] for r in conn.execute("SELECT username FROM users").fetchall()]
            kb_ids = [r[0] for r in conn.execute("SELECT id FROM knowledge_bases").fetchall()]
            now = datetime.utcnow().isoformat()
            for username in usernames:
                for kb_id in kb_ids:
                    perm_id = str(uuid.uuid4())
                    try:
                        conn.execute(
                            "INSERT INTO kb_user_permissions (id, kb_id, username, granted_at) VALUES (?,?,?,?)",
                            (perm_id, kb_id, username, now),
                        )
                    except sqlite3.IntegrityError:
                        pass
            conn.commit()
        logger.info("Phase 2 migration: granted all existing users access to all existing KBs")

    # ── Phase C: KB operation permissions ────────────────────────────────────

    def _do_grant_kb_permission(self, username: str, permission: str, granted_by: str) -> dict:
        pid = str(uuid.uuid4())
        now = datetime.utcnow().isoformat()
        with self._connect() as conn:
            try:
                conn.execute(
                    "INSERT INTO org_kb_permissions (id,username,permission,granted_by,granted_at) VALUES (?,?,?,?,?)",
                    (pid, username, permission, granted_by, now),
                )
                conn.commit()
                return {"ok": True}
            except sqlite3.IntegrityError:
                return {"ok": False, "reason": f"用户 '{username}' 已拥有 {permission} 权限"}

    async def grant_kb_permission(self, username: str, permission: str, granted_by: str) -> dict:
        return await asyncio.to_thread(self._do_grant_kb_permission, username, permission, granted_by)

    def _do_revoke_kb_permission(self, username: str, permission: str) -> bool:
        with self._connect() as conn:
            cur = conn.execute(
                "DELETE FROM org_kb_permissions WHERE username=? AND permission=?",
                (username, permission),
            )
            conn.commit()
        return cur.rowcount > 0

    async def revoke_kb_permission(self, username: str, permission: str) -> bool:
        return await asyncio.to_thread(self._do_revoke_kb_permission, username, permission)

    def _do_get_user_kb_permissions(self, username: str) -> set:
        with self._connect() as conn:
            rows = conn.execute(
                "SELECT permission FROM org_kb_permissions WHERE username=?", (username,)
            ).fetchall()
        return {r["permission"] for r in rows}

    async def get_user_kb_permissions(self, username: str) -> set:
        return await asyncio.to_thread(self._do_get_user_kb_permissions, username)

    def _do_list_org_member_kb_permissions(self, org_id: str) -> dict:
        """Return {username: ['read','write',...]} for all members of an org."""
        with self._connect() as conn:
            members = conn.execute(
                "SELECT username FROM org_members WHERE org_id=?", (org_id,)
            ).fetchall()
            if not members:
                return {}
            usernames = [m["username"] for m in members]
            placeholders = ",".join("?" * len(usernames))
            perm_rows = conn.execute(
                f"SELECT username, permission FROM org_kb_permissions WHERE username IN ({placeholders})",
                usernames,
            ).fetchall()
        result: dict = {u: [] for u in usernames}
        for r in perm_rows:
            result[r["username"]].append(r["permission"])
        return result

    async def list_org_member_kb_permissions(self, org_id: str) -> dict:
        return await asyncio.to_thread(self._do_list_org_member_kb_permissions, org_id)

    def _do_get_accessible_org_ids(self, username: str) -> dict:
        """Compute {read: [org_ids], write: [org_ids]} for a user using recursive CTEs.

        Scope rules:
          Base   : always can READ KBs in own org
          org_admin role  : READ+WRITE own org + all descendants
          kb_write grant  : READ+WRITE own org + all descendants
          kb_read  grant  : READ all ancestors + all descendants
        """
        with self._connect() as conn:
            member_row = conn.execute(
                "SELECT org_id, role FROM org_members WHERE username=?", (username,)
            ).fetchone()
            if not member_row:
                return {"read": [], "write": []}

            user_org_id = member_row["org_id"]
            user_role   = member_row["role"]

            perm_rows = conn.execute(
                "SELECT permission FROM org_kb_permissions WHERE username=?", (username,)
            ).fetchall()
            permissions = {r["permission"] for r in perm_rows}

            # Descendants (exclusive of self)
            desc = [r[0] for r in conn.execute("""
                WITH RECURSIVE d(id) AS (
                    SELECT id FROM organizations WHERE parent_id=?
                    UNION ALL
                    SELECT o.id FROM organizations o JOIN d ON o.parent_id=d.id
                ) SELECT id FROM d
            """, (user_org_id,)).fetchall()]

            # Ancestors (exclusive of self)
            anc = [r[0] for r in conn.execute("""
                WITH RECURSIVE a(id, parent_id) AS (
                    SELECT id, parent_id FROM organizations WHERE id=?
                    UNION ALL
                    SELECT o.id, o.parent_id FROM organizations o JOIN a ON o.id=a.parent_id
                ) SELECT id FROM a WHERE id!=?
            """, (user_org_id, user_org_id)).fetchall()]

        read_ids  = {user_org_id}          # base: own org always readable
        write_ids: set = set()

        # org_admin: CRUD on own org + descendants
        if user_role == "admin":
            write_ids.add(user_org_id)
            write_ids.update(desc)
            read_ids.update(desc)

        # kb_write grant: CRUD on own org + descendants
        if "write" in permissions:
            write_ids.add(user_org_id)
            write_ids.update(desc)
            read_ids.update(desc)          # write implies read

        # kb_read grant: read ancestors + descendants
        if "read" in permissions:
            read_ids.update(anc)
            read_ids.update(desc)

        return {"read": list(read_ids), "write": list(write_ids)}

    async def get_accessible_org_ids_for_user(self, username: str) -> dict:
        """Async wrapper for _do_get_accessible_org_ids."""
        return await asyncio.to_thread(self._do_get_accessible_org_ids, username)

    def _do_list_by_org_ids(self, org_ids: list) -> list:
        if not org_ids:
            return []
        placeholders = ",".join("?" * len(org_ids))
        with self._connect() as conn:
            rows = conn.execute(
                f"SELECT * FROM knowledge_bases WHERE org_id IN ({placeholders}) ORDER BY created_at ASC",
                org_ids,
            ).fetchall()
        return [self._row_to_kb(r) for r in rows]

    async def list_kbs_by_org_ids(self, org_ids: list) -> list[KnowledgeBase]:
        """Return KBs belonging to any of the given org IDs."""
        return await asyncio.to_thread(self._do_list_by_org_ids, org_ids)

    async def migrate_grant_all_users_all_kbs(self):
        """Idempotent startup migration for Phase 2 deployment."""
        await asyncio.to_thread(self._do_migrate_all)

    # ── Organization CRUD (Phase A) ───────────────────────────────────────────

    def _row_to_org(self, row: sqlite3.Row, member_count: int = 0) -> Organization:
        return Organization(
            id=row["id"], name=row["name"], parent_id=row["parent_id"],
            description=row["description"],
            created_at=row["created_at"], updated_at=row["updated_at"],
            member_count=member_count,
        )

    def _do_create_org(self, org_id, name, parent_id, description, now):
        with self._connect() as conn:
            conn.execute(
                "INSERT INTO organizations (id,name,parent_id,description,created_at,updated_at) VALUES (?,?,?,?,?,?)",
                (org_id, name, parent_id, description, now, now),
            )
            conn.commit()
        return Organization(id=org_id, name=name, parent_id=parent_id,
                            description=description, created_at=now, updated_at=now)

    async def create_org(self, name: str, parent_id: Optional[str] = None,
                         description: str = "") -> Organization:
        org_id = str(uuid.uuid4())
        now = datetime.utcnow().isoformat()
        return await asyncio.to_thread(self._do_create_org, org_id, name, parent_id, description, now)

    def _do_list_orgs_flat(self) -> list:
        with self._connect() as conn:
            rows = conn.execute("SELECT * FROM organizations ORDER BY created_at ASC").fetchall()
            counts = {r[0]: r[1] for r in conn.execute(
                "SELECT org_id, COUNT(*) FROM org_members GROUP BY org_id"
            ).fetchall()}
            return [self._row_to_org(r, counts.get(r["id"], 0)) for r in rows]

    async def list_orgs_flat(self) -> list[Organization]:
        return await asyncio.to_thread(self._do_list_orgs_flat)

    def _build_tree(self, orgs: list[Organization]) -> list[Organization]:
        """Convert flat list to nested tree (roots = those with parent_id=None)."""
        by_id = {o.id: o for o in orgs}
        roots = []
        for o in orgs:
            if o.parent_id and o.parent_id in by_id:
                by_id[o.parent_id].children.append(o)
            elif not o.parent_id:
                roots.append(o)
        return roots

    async def get_org_tree(self) -> list[Organization]:
        flat = await self.list_orgs_flat()
        return self._build_tree(flat)

    def _do_get_org(self, org_id: str) -> Optional[Organization]:
        with self._connect() as conn:
            row = conn.execute("SELECT * FROM organizations WHERE id=?", (org_id,)).fetchone()
            if not row:
                return None
            count = conn.execute("SELECT COUNT(*) FROM org_members WHERE org_id=?", (org_id,)).fetchone()[0]
            return self._row_to_org(row, count)

    async def get_org_by_id(self, org_id: str) -> Optional[Organization]:
        return await asyncio.to_thread(self._do_get_org, org_id)

    def _do_update_org(self, org_id: str, fields: dict) -> Optional[Organization]:
        now = datetime.utcnow().isoformat()
        fields["updated_at"] = now
        sets = ", ".join(f"{k}=?" for k in fields)
        vals = list(fields.values()) + [org_id]
        with self._connect() as conn:
            conn.execute(f"UPDATE organizations SET {sets} WHERE id=?", vals)
            conn.commit()
        return self._do_get_org(org_id)

    async def update_org(self, org_id: str, **kwargs) -> Optional[Organization]:
        fields = {k: v for k, v in kwargs.items() if k in ("name", "description", "parent_id")}
        if not fields:
            return await self.get_org_by_id(org_id)
        return await asyncio.to_thread(self._do_update_org, org_id, fields)

    def _do_delete_org(self, org_id: str) -> dict:
        with self._connect() as conn:
            child = conn.execute("SELECT id FROM organizations WHERE parent_id=?", (org_id,)).fetchone()
            if child:
                return {"ok": False, "reason": "该组织下还有子组织，请先删除子组织"}
            member = conn.execute("SELECT id FROM org_members WHERE org_id=?", (org_id,)).fetchone()
            if member:
                return {"ok": False, "reason": "该组织下还有成员，请先移除所有成员"}
            conn.execute("DELETE FROM organizations WHERE id=?", (org_id,))
            conn.commit()
        return {"ok": True}

    async def delete_org(self, org_id: str) -> dict:
        return await asyncio.to_thread(self._do_delete_org, org_id)

    def _do_get_descendant_ids(self, org_id: str) -> list[str]:
        """Return all descendant org IDs (excluding self) via recursive CTE."""
        with self._connect() as conn:
            rows = conn.execute("""
                WITH RECURSIVE descendants(id) AS (
                    SELECT id FROM organizations WHERE parent_id = ?
                    UNION ALL
                    SELECT o.id FROM organizations o
                    JOIN descendants d ON o.parent_id = d.id
                )
                SELECT id FROM descendants
            """, (org_id,)).fetchall()
        return [r[0] for r in rows]

    async def get_descendant_ids(self, org_id: str) -> list[str]:
        return await asyncio.to_thread(self._do_get_descendant_ids, org_id)

    def _do_get_ancestor_ids(self, org_id: str) -> list[str]:
        """Return all ancestor org IDs (excluding self) via recursive CTE."""
        with self._connect() as conn:
            rows = conn.execute("""
                WITH RECURSIVE ancestors(id, parent_id) AS (
                    SELECT id, parent_id FROM organizations WHERE id = ?
                    UNION ALL
                    SELECT o.id, o.parent_id FROM organizations o
                    JOIN ancestors a ON o.id = a.parent_id
                )
                SELECT id FROM ancestors WHERE id != ?
            """, (org_id, org_id)).fetchall()
        return [r[0] for r in rows]

    async def get_ancestor_ids(self, org_id: str) -> list[str]:
        return await asyncio.to_thread(self._do_get_ancestor_ids, org_id)

    # ── OrgMember CRUD (Phase A) ──────────────────────────────────────────────

    def _do_add_member(self, org_id: str, username: str, role: str) -> dict:
        member_id = str(uuid.uuid4())
        now = datetime.utcnow().isoformat()
        with self._connect() as conn:
            try:
                conn.execute(
                    "INSERT INTO org_members (id,org_id,username,role,joined_at) VALUES (?,?,?,?,?)",
                    (member_id, org_id, username, role, now),
                )
                conn.commit()
                return {"ok": True, "member": OrgMember(id=member_id, org_id=org_id,
                                                         username=username, role=role, joined_at=now)}
            except sqlite3.IntegrityError:
                # Username UNIQUE violation → already in another org
                existing = conn.execute(
                    "SELECT org_id FROM org_members WHERE username=?", (username,)
                ).fetchone()
                if existing and existing[0] != org_id:
                    return {"ok": False, "reason": f"用户 '{username}' 已属于其他组织"}
                return {"ok": False, "reason": f"用户 '{username}' 已是该组织成员"}

    async def add_org_member(self, org_id: str, username: str, role: str = "member") -> dict:
        return await asyncio.to_thread(self._do_add_member, org_id, username, role)

    def _do_remove_member(self, org_id: str, username: str) -> bool:
        with self._connect() as conn:
            cur = conn.execute(
                "DELETE FROM org_members WHERE org_id=? AND username=?", (org_id, username)
            )
            conn.commit()
        return cur.rowcount > 0

    async def remove_org_member(self, org_id: str, username: str) -> bool:
        return await asyncio.to_thread(self._do_remove_member, org_id, username)

    def _do_update_member_role(self, org_id: str, username: str, role: str) -> bool:
        with self._connect() as conn:
            cur = conn.execute(
                "UPDATE org_members SET role=? WHERE org_id=? AND username=?",
                (role, org_id, username),
            )
            conn.commit()
        return cur.rowcount > 0

    async def update_org_member_role(self, org_id: str, username: str, role: str) -> bool:
        return await asyncio.to_thread(self._do_update_member_role, org_id, username, role)

    def _do_list_members(self, org_id: str) -> list:
        with self._connect() as conn:
            rows = conn.execute(
                "SELECT * FROM org_members WHERE org_id=? ORDER BY joined_at ASC", (org_id,)
            ).fetchall()
        return [OrgMember(id=r["id"], org_id=r["org_id"], username=r["username"],
                          role=r["role"], joined_at=r["joined_at"]) for r in rows]

    async def list_org_members(self, org_id: str) -> list[OrgMember]:
        return await asyncio.to_thread(self._do_list_members, org_id)

    def _do_get_user_org(self, username: str) -> Optional[OrgMember]:
        with self._connect() as conn:
            row = conn.execute(
                "SELECT * FROM org_members WHERE username=?", (username,)
            ).fetchone()
        if not row:
            return None
        return OrgMember(id=row["id"], org_id=row["org_id"], username=row["username"],
                         role=row["role"], joined_at=row["joined_at"])

    async def get_user_org(self, username: str) -> Optional[OrgMember]:
        """Return the org membership for a user, or None if unassigned."""
        return await asyncio.to_thread(self._do_get_user_org, username)


# ── Singleton ─────────────────────────────────────────────────────────────────

_kb_db: Optional[KBDatabase] = None


def get_kb_db() -> KBDatabase:
    if _kb_db is None:
        raise RuntimeError("KBDatabase not initialized. Call init_kb_db() first.")
    return _kb_db


def init_kb_db(db_path: str) -> KBDatabase:
    global _kb_db
    _kb_db = KBDatabase(db_path)
    return _kb_db

