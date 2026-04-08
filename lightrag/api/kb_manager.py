"""
Knowledge Base RAG instance manager for LightRAG multi-KB support (Phase 1).

Design:
  - KnowledgeBaseManager holds a dict of LightRAG + DocumentManager per KB id.
  - RagProxy / DocManagerProxy delegate every attribute access to the
    ContextVar-stored instance for the current request, so existing route
    closures require zero changes.
  - HTTP middleware (in lightrag_server.py) reads X-KB-ID and sets the vars.
"""

from __future__ import annotations

import asyncio
from contextvars import ContextVar
from datetime import datetime, timezone
from typing import Any, Callable, Optional

from lightrag.utils import logger


# ── ContextVars (one per async request context) ──────────────────────────────

_current_rag: ContextVar[Any] = ContextVar("current_rag", default=None)
_current_doc_manager: ContextVar[Any] = ContextVar("current_doc_manager", default=None)
_current_kb_id: ContextVar[Optional[str]] = ContextVar("current_kb_id", default=None)


def get_current_kb_id() -> Optional[str]:
    """Return the KB ID bound to the current async context (request or background task)."""
    return _current_kb_id.get()


# ── Transparent Proxies ───────────────────────────────────────────────────────


class RagProxy:
    """
    Delegates every attribute access to the current request's LightRAG instance.

    Static attributes (e.g. `ollama_server_infos`) that are accessed at app-init
    time (before any request arrives) can be pre-populated via `set_static_attr`.
    """

    def __init__(self) -> None:
        # Use object.__setattr__ to avoid triggering our own __getattr__
        object.__setattr__(self, "_static_attrs", {})

    def set_static_attr(self, name: str, value: Any) -> None:
        """Pre-populate an attribute that may be read before the first request."""
        object.__getattribute__(self, "_static_attrs")[name] = value

    def __getattr__(self, name: str) -> Any:
        # 1. Check static attrs (app-init values)
        static = object.__getattribute__(self, "_static_attrs")
        if name in static:
            return static[name]
        # 2. Delegate to request-bound RAG instance
        rag = _current_rag.get()
        if rag is None:
            raise RuntimeError(
                f"Cannot access '{name}': No RAG instance bound to this request. "
                "Ensure the KB routing middleware is active."
            )
        return getattr(rag, name)


class DocManagerProxy:
    """Delegates every attribute access to the current request's DocumentManager."""

    def __getattr__(self, name: str) -> Any:
        dm = _current_doc_manager.get()
        if dm is None:
            raise RuntimeError(
                "No DocumentManager bound to this request. "
                "Ensure the KB routing middleware is active."
            )
        return getattr(dm, name)


# ── Module-level proxy singletons (used in lightrag_server route registration) ─

rag_proxy = RagProxy()
doc_manager_proxy = DocManagerProxy()


# ── Startup helper ────────────────────────────────────────────────────────────


async def _reset_stuck_processing_docs(rag: Any, kb_name: str) -> None:
    """Reset documents stuck in PROCESSING state back to PENDING.

    When the server crashes or restarts mid-pipeline, documents remain in
    PROCESSING state permanently. They will only be retried when the next
    document is inserted, which may never happen.  Calling this at KB load
    time ensures they are queued for retry on the next pipeline run.
    """
    try:
        from lightrag.base import DocStatus

        processing_docs = await rag.doc_status.get_docs_by_status(DocStatus.PROCESSING)
        if not processing_docs:
            return

        now = datetime.now(timezone.utc).isoformat()
        docs_to_reset: dict[str, dict] = {}
        for doc_id, status_doc in processing_docs.items():
            chunks_list: list[str] = []
            if isinstance(getattr(status_doc, "chunks_list", None), list):
                chunks_list = [
                    c for c in status_doc.chunks_list if isinstance(c, str) and c
                ]
            chunks_count = len(chunks_list)
            if isinstance(getattr(status_doc, "chunks_count", None), int):
                chunks_count = status_doc.chunks_count

            docs_to_reset[doc_id] = {
                "status": DocStatus.PENDING,
                "content_summary": getattr(status_doc, "content_summary", ""),
                "content_length": getattr(status_doc, "content_length", 0),
                "chunks_count": chunks_count,
                "chunks_list": chunks_list,
                "created_at": getattr(status_doc, "created_at", now),
                "updated_at": now,
                "file_path": getattr(status_doc, "file_path", None) or "unknown_source",
                "track_id": getattr(status_doc, "track_id", "") or "",
                "error_msg": "",
                "metadata": {},
            }

        await rag.doc_status.upsert(docs_to_reset)
        logger.info(
            f"KBManager [{kb_name}]: reset {len(docs_to_reset)} stuck PROCESSING "
            f"document(s) to PENDING — they will be reprocessed on next pipeline run"
        )
    except Exception as exc:
        logger.warning(f"KBManager [{kb_name}]: failed to reset stuck docs: {exc}")


# ── KnowledgeBaseManager ──────────────────────────────────────────────────────


class KnowledgeBaseManager:
    """
    Manages LightRAG + DocumentManager instances keyed by KB id.

    Phase 1: static pre-load – all KBs are loaded at server startup and when
    a new KB is created via the API. No LRU eviction (Phase 2 concern).
    """

    def __init__(self, rag_factory: Callable[[str], Any], input_dir: str):
        """
        Args:
            rag_factory: callable(workspace: str) -> LightRAG (uninitialised)
            input_dir: base input directory for DocumentManager
        """
        self._rag_factory = rag_factory
        self._input_dir = input_dir
        self._instances: dict[str, Any] = {}  # kb_id → LightRAG
        self._doc_managers: dict[str, Any] = {}  # kb_id → DocumentManager
        self._default_kb_id: str = ""
        self._lock = asyncio.Lock()

    # ── Instance lifecycle ────────────────────────────────────────────────────

    async def load_kb(self, kb: Any) -> Any:
        """Create, initialise and cache a LightRAG instance for the given KB."""
        async with self._lock:
            if kb.id in self._instances:
                return self._instances[kb.id]

            logger.info(
                f"KBManager: loading KB '{kb.name}' (workspace='{kb.workspace}')"
            )
            rag = self._rag_factory(kb.workspace)
            await rag.initialize_storages()
            await rag.check_and_migrate_data()

            # Reset any documents stuck in PROCESSING state due to a previous crash/restart.
            # Without this, docs that were mid-flight when the server died stay "processing"
            # forever and are only retried when the next new document is inserted.
            await _reset_stuck_processing_docs(rag, kb.name)

            from lightrag.api.routers.document_routes import DocumentManager

            doc_mgr = DocumentManager(self._input_dir, workspace=kb.workspace)

            self._instances[kb.id] = rag
            self._doc_managers[kb.id] = doc_mgr
            logger.info(f"KBManager: KB '{kb.name}' ready")
            return rag

    async def unload_kb(self, kb_id: str):
        """Finalise and remove a KB instance from the pool."""
        async with self._lock:
            rag = self._instances.pop(kb_id, None)
            if rag:
                await rag.finalize_storages()
            self._doc_managers.pop(kb_id, None)

    async def finalize_all(self):
        """Finalise all managed RAG instances (called at server shutdown)."""
        kb_ids = list(self._instances.keys())
        for kb_id in kb_ids:
            try:
                await self.unload_kb(kb_id)
            except Exception as e:
                logger.warning(f"KBManager: error finalizing KB {kb_id}: {e}")

    # ── Accessors ─────────────────────────────────────────────────────────────

    def get_instance(self, kb_id: str) -> Any:
        inst = self._instances.get(kb_id)
        if inst is None:
            raise KeyError(f"Knowledge base '{kb_id}' is not loaded.")
        return inst

    def get_doc_manager(self, kb_id: str) -> Any:
        dm = self._doc_managers.get(kb_id)
        if dm is None:
            raise KeyError(f"DocumentManager for KB '{kb_id}' is not loaded.")
        return dm

    def set_current_request(self, kb_id: str):
        """Bind the appropriate instances to the current async context.

        Returns a tuple of ContextVar tokens for cleanup in middleware finally.
        """
        rag = self.get_instance(kb_id)
        dm = self.get_doc_manager(kb_id)
        t1 = _current_rag.set(rag)
        t2 = _current_doc_manager.set(dm)
        t3 = _current_kb_id.set(kb_id)
        return t1, t2, t3

    @property
    def default_kb_id(self) -> str:
        return self._default_kb_id

    @default_kb_id.setter
    def default_kb_id(self, value: str):
        self._default_kb_id = value

    @property
    def loaded_kb_ids(self) -> list[str]:
        return list(self._instances.keys())

    @property
    def working_dir(self) -> str:
        """Return the base working directory shared by all KB instances."""
        for rag in self._instances.values():
            wd = getattr(rag, "working_dir", None)
            if wd:
                return wd
        return ""


# ── Singleton ─────────────────────────────────────────────────────────────────

_kb_manager: Optional[KnowledgeBaseManager] = None


def get_kb_manager() -> KnowledgeBaseManager:
    if _kb_manager is None:
        raise RuntimeError("KnowledgeBaseManager not initialised.")
    return _kb_manager


def init_kb_manager(rag_factory: Callable, input_dir: str) -> KnowledgeBaseManager:
    global _kb_manager
    _kb_manager = KnowledgeBaseManager(rag_factory, input_dir)
    return _kb_manager
