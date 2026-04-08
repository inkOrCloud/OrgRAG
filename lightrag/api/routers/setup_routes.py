"""
Setup / initialization wizard routes for LightRAG API.

These endpoints are PUBLIC (no JWT required) and are only operational when
the system has not yet been initialized.

Endpoints:
  GET  /setup/status  - check whether initial setup is required
  POST /setup         - complete the initial setup (admin + org + KB)
"""

from sqlite3 import IntegrityError

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, field_validator

router = APIRouter(prefix="/setup", tags=["Setup"])


# ── Request schema ─────────────────────────────────────────────────────────────


class SetupRequest(BaseModel):
    # Admin account
    admin_username: str
    admin_password: str
    admin_email: str = ""

    # Root organization
    org_name: str
    org_description: str = ""

    # First knowledge base
    kb_name: str
    kb_description: str = ""

    @field_validator("admin_username")
    @classmethod
    def username_not_empty(cls, v: str) -> str:
        if not v.strip():
            raise ValueError("用户名不能为空")
        return v.strip()

    @field_validator("admin_password")
    @classmethod
    def password_min_length(cls, v: str) -> str:
        if len(v) < 6:
            raise ValueError("密码至少需要6个字符")
        return v

    @field_validator("org_name")
    @classmethod
    def org_name_not_empty(cls, v: str) -> str:
        if not v.strip():
            raise ValueError("组织名称不能为空")
        return v.strip()

    @field_validator("kb_name")
    @classmethod
    def kb_name_not_empty(cls, v: str) -> str:
        if not v.strip():
            raise ValueError("知识库名称不能为空")
        return v.strip()


# ── Routes ─────────────────────────────────────────────────────────────────────


@router.get("/status", summary="Check if initial setup is required")
async def get_setup_status():
    """
    Returns whether the initial setup wizard needs to be completed.
    This endpoint is always public (no authentication required).
    """
    from lightrag.api.kb_db import get_kb_db

    kb_db = get_kb_db()
    setup_done = await kb_db.is_setup_complete()
    return {"setup_required": not setup_done}


@router.post("", summary="Complete initial system setup", status_code=201)
async def complete_setup(body: SetupRequest):
    """
    Performs the one-time initialization:
      1. Creates the initial admin user
      2. Creates the root organization
      3. Adds admin as org admin member
      4. Creates the first knowledge base (assigned to root org)
      5. Loads the KB into the running KBManager
      6. Marks setup as complete

    Returns a JWT access token so the frontend can auto-login after setup.
    """
    from lightrag.api.kb_db import get_kb_db
    from lightrag.api.user_db import get_user_db
    from lightrag.api.kb_manager import get_kb_manager
    from lightrag.api.auth import auth_handler

    kb_db = get_kb_db()
    user_db = get_user_db()

    # Guard: refuse if setup already complete
    if await kb_db.is_setup_complete():
        raise HTTPException(status_code=409, detail="系统已完成初始化，无法重复执行")

    # 1. Create admin user
    try:
        admin = await user_db.create_user(
            username=body.admin_username,
            password=body.admin_password,
            role="admin",
            email=body.admin_email,
        )
    except IntegrityError:
        raise HTTPException(
            status_code=409, detail=f"用户名 '{body.admin_username}' 已存在"
        )

    # 2. Create root organization
    org = await kb_db.create_org(
        name=body.org_name,
        description=body.org_description,
    )

    # 3. Add admin as org admin
    await kb_db.add_org_member(org.id, admin.username, role="admin")

    # 4. Create first knowledge base under the root org
    kb = await kb_db.create_kb(
        name=body.kb_name,
        description=body.kb_description,
        owner_username=admin.username,
        org_id=org.id,
    )

    # 5. Load the KB into the running manager
    kb_manager = get_kb_manager()
    await kb_manager.load_kb(kb)
    kb_manager.default_kb_id = kb.id

    # 6. Mark setup as complete
    await kb_db.mark_setup_complete()

    # 7. Issue a JWT token so the frontend can auto-login
    token = auth_handler.create_token(admin.username, role="admin")

    return {
        "message": "系统初始化完成",
        "access_token": token,
        "token_type": "bearer",
        "role": "admin",
        "username": admin.username,
    }
