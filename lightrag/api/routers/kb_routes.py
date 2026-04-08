"""
Knowledge Base management routes for LightRAG multi-KB support.

Endpoints:
  GET    /kbs           - list KBs visible to current user (org-based)
  POST   /kbs           - create KB (org-admin or system-admin)
  GET    /kbs/{kb_id}   - get KB detail
  PUT    /kbs/{kb_id}   - update KB (org-admin or system-admin)
  DELETE /kbs/{kb_id}   - delete KB (org-admin or system-admin)

Access control is purely org-based. KB membership is no longer used.
"""

import io
import json
import os
import re
import tempfile
import zipfile
from typing import Any, Optional
from sqlite3 import IntegrityError
from fastapi import (
    APIRouter,
    BackgroundTasks,
    HTTPException,
    Security,
    UploadFile,
    File,
)
from fastapi.responses import FileResponse
from pydantic import BaseModel, Field

from lightrag.api.kb_db import get_kb_db
from lightrag.api.kb_manager import get_kb_manager
from lightrag.api.auth import get_current_user, require_admin
from lightrag.utils import logger

router = APIRouter(prefix="/kbs", tags=["Knowledge Bases"])


# ── Schemas ───────────────────────────────────────────────────────────────────


class KBCreateRequest(BaseModel):
    name: str
    description: str = ""
    org_id: Optional[str] = None  # Phase B: owning organization


class KBUpdateRequest(BaseModel):
    name: Optional[str] = None
    description: Optional[str] = None
    is_active: Optional[bool] = None


# ── Helpers ───────────────────────────────────────────────────────────────────


def _enrich(kb, kb_manager, can_write: bool = True) -> dict:
    d = kb.to_dict()
    d["loaded"] = kb.id in kb_manager.loaded_kb_ids
    d["is_default"] = kb.id == kb_manager.default_kb_id
    d["can_write"] = can_write
    return d


async def _can_manage_kb(current_user: dict, kb_org_id: Optional[str]) -> bool:
    """Return True if the user may create/update/delete the KB.

    Allowed when:
      - System admin, OR
      - Org-admin whose managed subtree includes kb_org_id, OR
      - User has kb_write permission and kb_org_id is within their write scope
    """
    if current_user.get("role") == "admin":
        return True
    if not kb_org_id:
        return False
    db = get_kb_db()
    # Phase C: check write scope (covers org_admin + kb_write grant)
    accessible = await db.get_accessible_org_ids_for_user(current_user["username"])
    return kb_org_id in accessible["write"]


# ── Routes ────────────────────────────────────────────────────────────────────


@router.get("", summary="List knowledge bases visible to current user")
async def list_kbs(current_user: dict = Security(get_current_user)):
    db = get_kb_db()
    kb_manager = get_kb_manager()
    if current_user.get("role") == "admin":
        kbs = await db.list_kbs()
        # System admin always has full write access
        return {
            "kbs": [_enrich(kb, kb_manager, can_write=True) for kb in kbs],
            "total": len(kbs),
        }
    else:
        # Phase C: union of read-scope + write-scope org IDs
        accessible = await db.get_accessible_org_ids_for_user(current_user["username"])
        write_org_ids = set(accessible["write"])
        all_org_ids = list(set(accessible["read"]) | write_org_ids)
        if all_org_ids:
            kbs = await db.list_kbs_by_org_ids(all_org_ids)
        else:
            kbs = []  # No org membership → no KB access

        def _enrich_with_write(kb):
            # can_write if the KB's org is in the user's write scope
            can_write = kb.org_id in write_org_ids if kb.org_id else False
            return _enrich(kb, kb_manager, can_write=can_write)

        return {"kbs": [_enrich_with_write(kb) for kb in kbs], "total": len(kbs)}


@router.post(
    "",
    summary="Create a new knowledge base",
    status_code=201,
    responses={
        201: {
            "description": "Knowledge base created successfully",
            "content": {
                "application/json": {
                    "example": {
                        "kb": {
                            "id": "550e8400-e29b-41d4-a716-446655440000",
                            "name": "Product Docs",
                            "description": "...",
                            "is_active": True,
                            "is_default": False,
                            "loaded": True,
                            "workspace": "kb_550e8400",
                            "created_at": "2025-03-26T10:00:00Z",
                        },
                        "message": "Knowledge base created successfully",
                    }
                }
            },
        },
        400: {"description": "KB name is required"},
        403: {"description": "Insufficient permissions"},
        409: {"description": "Knowledge base with this name already exists"},
    },
)
async def create_kb(
    body: KBCreateRequest,
    current_user: dict = Security(get_current_user),
):
    if not body.name or not body.name.strip():
        raise HTTPException(status_code=400, detail="KB name is required")

    db = get_kb_db()
    kb_manager = get_kb_manager()

    # Resolve org_id: explicit > user's own org > None (admin only)
    org_id = body.org_id
    is_system_admin = current_user.get("role") == "admin"

    if not org_id:
        # Non-admin must have an org to create a KB
        membership = await db.get_user_org(current_user["username"])
        if membership:
            org_id = membership.org_id
        elif not is_system_admin:
            raise HTTPException(
                status_code=403, detail="您尚未加入任何组织，无法创建知识库"
            )

    # Permission check: must be system admin or org-admin of target org
    if not await _can_manage_kb(current_user, org_id):
        raise HTTPException(
            status_code=403, detail="无权在该组织下创建知识库（需要组织管理员权限）"
        )

    try:
        kb = await db.create_kb(
            name=body.name.strip(),
            description=body.description,
            owner_username=current_user["username"],
            org_id=org_id,
        )
    except IntegrityError:
        raise HTTPException(
            status_code=409, detail=f"Knowledge base '{body.name}' already exists"
        )

    try:
        await kb_manager.load_kb(kb)
        logger.info(
            f"KB '{kb.name}' created and loaded (org={org_id}, workspace={kb.workspace})"
        )
    except Exception as e:
        await db.delete_kb(kb.id)
        raise HTTPException(
            status_code=500, detail=f"Failed to initialise KB storage: {e}"
        )

    d = kb.to_dict()
    d["loaded"] = True
    d["is_default"] = False
    d["can_write"] = True
    return {"kb": d, "message": "Knowledge base created successfully"}


@router.get("/{kb_id}", summary="Get knowledge base detail")
async def get_kb(kb_id: str, current_user: dict = Security(get_current_user)):
    db = get_kb_db()
    kb = await db.get_kb_by_id(kb_id)
    if not kb:
        raise HTTPException(status_code=404, detail="Knowledge base not found")
    if current_user.get("role") != "admin":
        if not await db.has_kb_access(kb_id, current_user["username"]):
            raise HTTPException(
                status_code=403, detail="Access denied to this knowledge base"
            )
    kb_manager = get_kb_manager()
    return {"kb": _enrich(kb, kb_manager)}


@router.put("/{kb_id}", summary="Update knowledge base")
async def update_kb(
    kb_id: str,
    body: KBUpdateRequest,
    current_user: dict = Security(get_current_user),
):
    db = get_kb_db()
    existing = await db.get_kb_by_id(kb_id)
    if not existing:
        raise HTTPException(status_code=404, detail="Knowledge base not found")
    if not await _can_manage_kb(current_user, existing.org_id):
        raise HTTPException(
            status_code=403, detail="无权修改该知识库（需要所属组织的管理员权限）"
        )

    kwargs = {}
    if body.name is not None:
        kwargs["name"] = body.name.strip()
    if body.description is not None:
        kwargs["description"] = body.description
    if body.is_active is not None:
        kwargs["is_active"] = body.is_active

    try:
        kb = await db.update_kb(kb_id, **kwargs)
    except IntegrityError:
        raise HTTPException(
            status_code=409, detail=f"Name '{body.name}' already exists"
        )

    kb_manager = get_kb_manager()
    return {
        "kb": _enrich(kb, kb_manager),
        "message": "Knowledge base updated successfully",
    }


@router.delete("/{kb_id}", summary="Delete knowledge base")
async def delete_kb(kb_id: str, current_user: dict = Security(get_current_user)):
    kb_manager = get_kb_manager()

    if kb_id == kb_manager.default_kb_id:
        raise HTTPException(
            status_code=400, detail="Cannot delete the default knowledge base"
        )

    db = get_kb_db()
    existing = await db.get_kb_by_id(kb_id)
    if not existing:
        raise HTTPException(status_code=404, detail="Knowledge base not found")
    if not await _can_manage_kb(current_user, existing.org_id):
        raise HTTPException(
            status_code=403, detail="无权删除该知识库（需要所属组织的管理员权限）"
        )

    await kb_manager.unload_kb(kb_id)
    await db.delete_kb(kb_id)
    return {"message": f"Knowledge base '{existing.name}' deleted successfully"}


# ── Stats (Phase 3) ───────────────────────────────────────────────────────────


@router.get("/{kb_id}/stats", summary="Get KB statistics")
async def get_kb_stats(kb_id: str, current_user: dict = Security(get_current_user)):
    db = get_kb_db()
    kb = await db.get_kb_by_id(kb_id)
    if not kb:
        raise HTTPException(status_code=404, detail="Knowledge base not found")
    if current_user.get("role") != "admin":
        if not await db.has_kb_access(kb_id, current_user["username"]):
            raise HTTPException(status_code=403, detail="Access denied")

    kb_manager = get_kb_manager()
    if kb_id not in kb_manager.loaded_kb_ids:
        raise HTTPException(status_code=503, detail="Knowledge base is not loaded")

    rag = kb_manager.get_instance(kb_id)
    try:
        # Document counts by status
        doc_counts: dict[str, int] = await rag.get_processing_status()
        # Graph node/edge counts
        nodes = await rag.chunk_entity_relation_graph.get_all_nodes()
        edges = await rag.chunk_entity_relation_graph.get_all_edges()
        node_count = len(nodes)
        edge_count = len(edges)
        # Chunk count: sum chunks_count from all processed docs
        from lightrag.base import DocStatus

        processed = await rag.doc_status.get_docs_by_status(DocStatus.PROCESSED)
        chunk_count = sum(
            (
                getattr(d, "chunks_count", None) or d.get("chunks_count", 0)
                if not hasattr(d, "__dataclass_fields__")
                else d.chunks_count or 0
            )
            for d in processed.values()
        )
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to collect stats: {e}")

    return {
        "kb_id": kb_id,
        "doc_counts": doc_counts,
        "node_count": node_count,
        "edge_count": edge_count,
        "chunk_count": chunk_count,
    }


# ── Settings (Phase 3) ────────────────────────────────────────────────────────


class KBSettingsRequest(BaseModel):
    mode: Optional[str] = Field(
        default=None,
        description="Query mode: local | global | hybrid | naive | mix",
        json_schema_extra={"example": "hybrid"},
    )
    top_k: Optional[int] = Field(
        default=None,
        description="Number of top KG entities/relations to retrieve",
        ge=1,
    )
    chunk_top_k: Optional[int] = Field(
        default=None, description="Number of top text chunks to retrieve", ge=1
    )
    max_entity_tokens: Optional[int] = Field(
        default=None, description="Max tokens for entity context", ge=1
    )
    max_relation_tokens: Optional[int] = Field(
        default=None, description="Max tokens for relation context", ge=1
    )
    max_total_tokens: Optional[int] = Field(
        default=None, description="Max total tokens for LLM context", ge=1
    )
    enable_rerank: Optional[bool] = Field(
        default=None, description="Enable reranking of retrieved chunks"
    )
    response_type: Optional[str] = Field(
        default=None, description="Preferred response format hint for the LLM"
    )

    # ── Docling VLM settings ──────────────────────────────────────────────────
    # All fields are per-KB overrides; None means inherit the global server config.
    docling_vlm_enabled: Optional[bool] = Field(
        default=None,
        description="Enable VLM-assisted document parsing for this KB (overrides DOCLING_VLM_ENABLED env var)",
    )
    docling_vlm_mode: Optional[str] = Field(
        default=None,
        description=(
            "Docling VLM processing mode (overrides DOCLING_VLM_MODE env var). "
            "Allowed values: auto | picture_description | vlm_convert | disabled. "
            "'auto' probes for a text layer and falls back to vlm_convert for scanned docs."
        ),
        json_schema_extra={"example": "auto"},
    )
    docling_vlm_engine: Optional[str] = Field(
        default=None,
        description=(
            "VLM inference engine (overrides DOCLING_VLM_ENGINE env var). "
            "Allowed values: ollama | openai | lmstudio | api | local."
        ),
        json_schema_extra={"example": "ollama"},
    )
    docling_vlm_url: Optional[str] = Field(
        default=None,
        description="Custom VLM API endpoint URL; required when engine=api (overrides DOCLING_VLM_URL)",
        json_schema_extra={"example": "http://localhost:11434/v1/chat/completions"},
    )
    docling_vlm_api_key: Optional[str] = Field(
        default=None,
        description="Bearer API key for the VLM endpoint (overrides DOCLING_VLM_API_KEY)",
    )
    docling_vlm_model: Optional[str] = Field(
        default=None,
        description="Model name override; leave None to use the preset default (overrides DOCLING_VLM_MODEL)",
        json_schema_extra={"example": "ibm/granite-docling:258m"},
    )
    docling_vlm_timeout: Optional[int] = Field(
        default=None,
        description="Per-request VLM API timeout in seconds (overrides DOCLING_VLM_TIMEOUT)",
        ge=1,
    )


@router.get("/{kb_id}/settings", summary="Get KB query settings")
async def get_kb_settings(kb_id: str, current_user: dict = Security(get_current_user)):
    db = get_kb_db()
    kb = await db.get_kb_by_id(kb_id)
    if not kb:
        raise HTTPException(status_code=404, detail="Knowledge base not found")
    if current_user.get("role") != "admin":
        if not await db.has_kb_access(kb_id, current_user["username"]):
            raise HTTPException(status_code=403, detail="Access denied")
    settings = await db.get_kb_settings(kb_id)
    return {"kb_id": kb_id, "settings": settings}


@router.put("/{kb_id}/settings", summary="Update KB query settings (admin)")
async def update_kb_settings(
    kb_id: str,
    body: KBSettingsRequest,
    _: dict = Security(require_admin),
):
    db = get_kb_db()
    if not await db.get_kb_by_id(kb_id):
        raise HTTPException(status_code=404, detail="Knowledge base not found")
    # Merge with existing settings; None values remove a key
    existing = await db.get_kb_settings(kb_id)
    new_settings: dict[str, Any] = dict(existing)
    for k, v in body.model_dump(exclude_none=True).items():
        new_settings[k] = v
    await db.update_kb_settings(kb_id, new_settings)
    return {
        "kb_id": kb_id,
        "settings": new_settings,
        "message": "Settings updated successfully",
    }


# ── Export (Phase 3) ──────────────────────────────────────────────────────────


@router.get("/{kb_id}/export", summary="Export KB data as ZIP")
async def export_kb(
    kb_id: str, background_tasks: BackgroundTasks, _: dict = Security(require_admin)
):
    db = get_kb_db()
    kb = await db.get_kb_by_id(kb_id)
    if not kb:
        raise HTTPException(status_code=404, detail="Knowledge base not found")

    kb_manager = get_kb_manager()
    if kb_id not in kb_manager.loaded_kb_ids:
        raise HTTPException(status_code=503, detail="Knowledge base is not loaded")

    rag = kb_manager.get_instance(kb_id)
    working_dir: str = rag.working_dir
    workspace: str = rag.workspace or ""
    data_dir = os.path.join(working_dir, workspace) if workspace else working_dir

    if not os.path.isdir(data_dir):
        raise HTTPException(status_code=404, detail="KB data directory not found")

    # Files to exclude: LLM cache (regenerable) and oversized vector DBs
    EXCLUDE_FILES = {
        "kv_store_llm_response_cache.json",  # can be regenerated
        "vdb_entities.json",  # large (~100MB+), rebuilt from graphml
        "vdb_relationships.json",  # large (~100MB+), rebuilt from graphml
        "lightrag_users.db",  # system database, not KB data
    }
    MAX_SINGLE_FILE_MB = 50  # skip any single file over 50 MB

    manifest = {
        "kb_name": kb.name,
        "kb_description": kb.description,
        "kb_settings": kb.settings,
        "workspace": workspace,
        "exported_at": __import__("datetime").datetime.utcnow().isoformat(),
    }

    # Write ZIP to a temp file to avoid loading 100s of MB into memory
    tmp = tempfile.NamedTemporaryFile(suffix=".zip", delete=False)
    tmp_path = tmp.name
    tmp.close()

    try:
        with zipfile.ZipFile(tmp_path, "w", zipfile.ZIP_DEFLATED) as zf:
            zf.writestr(
                "kb_manifest.json", json.dumps(manifest, ensure_ascii=False, indent=2)
            )
            for fname in os.listdir(data_dir):
                if fname in EXCLUDE_FILES:
                    continue
                fpath = os.path.join(data_dir, fname)
                if not os.path.isfile(fpath):
                    continue
                size_mb = os.path.getsize(fpath) / (1024 * 1024)
                if size_mb > MAX_SINGLE_FILE_MB:
                    logger.warning(
                        f"Export: skipping large file '{fname}' ({size_mb:.1f} MB)"
                    )
                    continue
                zf.write(fpath, arcname=fname)
    except Exception as e:
        os.unlink(tmp_path)
        raise HTTPException(
            status_code=500, detail=f"Failed to create export archive: {e}"
        )

    safe_name = re.sub(r"[^a-zA-Z0-9_\-]", "_", kb.name)
    filename = f"kb_{safe_name}.zip"

    def _cleanup(path: str):
        try:
            os.unlink(path)
        except OSError:
            pass

    background_tasks.add_task(_cleanup, tmp_path)
    return FileResponse(
        tmp_path,
        media_type="application/zip",
        filename=filename,
    )


# ── Import (Phase 3) ──────────────────────────────────────────────────────────


@router.post(
    "/import",
    summary="Import KB from ZIP (admin)",
    status_code=201,
    responses={
        201: {
            "description": "Knowledge base imported successfully",
            "content": {
                "application/json": {
                    "example": {
                        "kb": {"id": "...", "name": "Imported KB", "loaded": True},
                        "message": "Knowledge base imported successfully",
                    }
                }
            },
        },
        400: {"description": "Invalid ZIP file or missing manifest"},
        403: {"description": "Admin access required"},
    },
)
async def import_kb(
    file: UploadFile = File(...),
    admin: dict = Security(require_admin),
):
    if not file.filename or not file.filename.endswith(".zip"):
        raise HTTPException(status_code=400, detail="Only .zip files are accepted")

    content = await file.read()
    try:
        buf = io.BytesIO(content)
        with zipfile.ZipFile(buf, "r") as zf:
            names = zf.namelist()
            if "kb_manifest.json" not in names:
                raise HTTPException(
                    status_code=400, detail="Invalid export: missing kb_manifest.json"
                )
            manifest = json.loads(zf.read("kb_manifest.json").decode("utf-8"))
    except zipfile.BadZipFile:
        raise HTTPException(status_code=400, detail="Invalid ZIP file")

    kb_name = manifest.get("kb_name", "Imported KB")
    kb_description = manifest.get("kb_description", "")
    kb_settings = manifest.get("kb_settings", {})

    kb_manager = get_kb_manager()
    db = get_kb_db()

    # Create new KB entry
    try:
        kb = await db.create_kb(
            name=kb_name,
            description=kb_description,
            owner_username=admin["username"],
        )
    except Exception:
        raise HTTPException(
            status_code=409, detail=f"A KB named '{kb_name}' already exists"
        )

    if kb_settings:
        await db.update_kb_settings(kb.id, kb_settings)

    # Extract data files to the new KB's workspace directory
    working_dir: str = kb_manager.working_dir
    if not working_dir:
        await db.delete_kb(kb.id)
        raise HTTPException(
            status_code=500, detail="Cannot determine working directory"
        )
    target_dir = os.path.join(working_dir, kb.workspace)
    os.makedirs(target_dir, exist_ok=True)

    buf = io.BytesIO(content)
    with zipfile.ZipFile(buf, "r") as zf:
        for name in zf.namelist():
            if name == "kb_manifest.json":
                continue
            zf.extract(name, target_dir)

    # Load the new KB RAG instance
    try:
        await kb_manager.load_kb(kb)
    except Exception as e:
        await db.delete_kb(kb.id)
        raise HTTPException(status_code=500, detail=f"Failed to load imported KB: {e}")

    logger.info(f"KB '{kb.name}' imported successfully (workspace={kb.workspace})")
    d = kb.to_dict()
    d["loaded"] = True
    d["is_default"] = False
    d["can_write"] = True
    return {"kb": d, "message": f"Knowledge base '{kb.name}' imported successfully"}
