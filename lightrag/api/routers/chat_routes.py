"""
Chat session routes for LightRAG API.

Endpoints:
  GET    /chat/sessions          - list current user's sessions (optional ?kb_id=)
  PUT    /chat/sessions/{id}     - create or update a session (upsert)
  DELETE /chat/sessions/{id}     - delete one session
  DELETE /chat/sessions          - clear all sessions (optional JSON body {kb_id})
"""

from typing import Optional, List, Any
from fastapi import APIRouter, Security
from pydantic import BaseModel

from lightrag.api.chat_session_db import get_chat_db
from lightrag.api.auth import get_current_user

router = APIRouter(prefix="/chat", tags=["Chat Sessions"])


# ── Request / Response Schemas ────────────────────────────────────────────────


class SaveSessionRequest(BaseModel):
    kb_id: Optional[str] = None
    messages: List[Any]  # stored as-is (list of ChatMessage objects)
    preview: str = ""
    mode: str = "hybrid"
    timestamp: int  # ms since epoch


class ClearSessionsRequest(BaseModel):
    kb_id: Optional[str] = None


# ── Routes ────────────────────────────────────────────────────────────────────


@router.get("/sessions", summary="List current user's chat sessions")
async def list_sessions(
    kb_id: Optional[str] = None,
    current_user: dict = Security(get_current_user),
):
    """Return saved chat sessions for the authenticated user.

    Pass `?kb_id=<id>` to filter by knowledge base.
    """
    db = get_chat_db()
    sessions = await db.list_sessions(current_user["username"], kb_id)
    return {"sessions": [s.to_dict() for s in sessions], "total": len(sessions)}


@router.put("/sessions/{session_id}", summary="Create or update a chat session")
async def save_session(
    session_id: str,
    body: SaveSessionRequest,
    current_user: dict = Security(get_current_user),
):
    """Upsert a chat session (create if new, update if exists).

    The session is always owned by the authenticated user – the server
    ignores any username supplied in the request body.
    """
    db = get_chat_db()
    session = await db.upsert_session(
        session_id=session_id,
        username=current_user["username"],
        kb_id=body.kb_id,
        messages=body.messages,
        preview=body.preview,
        mode=body.mode,
        timestamp=body.timestamp,
    )
    return {"session": session.to_dict(), "message": "Session saved"}


@router.delete("/sessions/{session_id}", summary="Delete a specific chat session")
async def delete_session(
    session_id: str,
    current_user: dict = Security(get_current_user),
):
    """Delete the specified session.  Silently succeeds if not found or
    owned by a different user."""
    db = get_chat_db()
    await db.delete_session(session_id, current_user["username"])
    return {"message": "Session deleted"}


@router.delete("/sessions", summary="Clear all chat sessions (optional: by KB)")
async def clear_sessions(
    body: ClearSessionsRequest = ClearSessionsRequest(),
    current_user: dict = Security(get_current_user),
):
    """Delete all sessions for the authenticated user.

    Supply `{"kb_id": "<id>"}` in the request body to restrict deletion
    to a single knowledge base.
    """
    db = get_chat_db()
    await db.clear_sessions(current_user["username"], body.kb_id)
    return {"message": "Sessions cleared"}
