"""
User management routes for LightRAG API.

Endpoints:
  GET    /users              - list all users (admin)
  POST   /users              - create user (admin)
  GET    /users/me           - current user info (any authenticated user)
  PUT    /users/me/password  - change own password (any authenticated user)
  POST   /users/me/avatar    - upload avatar (any authenticated user)
  DELETE /users/me/avatar    - remove avatar (any authenticated user)
  GET    /users/{id}         - get user detail (admin)
  PUT    /users/{id}         - update user (admin)
  DELETE /users/{id}         - delete user (admin)
"""

import os
import uuid as _uuid
from pathlib import Path
from typing import Optional
from fastapi import APIRouter, HTTPException, status, Depends, Security, UploadFile, File
from pydantic import BaseModel, field_validator
from sqlite3 import IntegrityError

from lightrag.api.user_db import get_user_db
from lightrag.api.auth import get_current_user, require_admin
from lightrag.api.config import global_args
from lightrag.utils import logger

# Allowed MIME types and their canonical extensions
_ALLOWED_MIME: dict[str, str] = {
    "image/jpeg": ".jpg",
    "image/png": ".png",
    "image/gif": ".gif",
    "image/webp": ".webp",
}
_MAX_AVATAR_BYTES = 2 * 1024 * 1024  # 2 MB


def _avatars_dir() -> Path:
    """Return (and create) the avatars storage directory."""
    d = Path(global_args.working_dir) / "avatars"
    d.mkdir(parents=True, exist_ok=True)
    return d

router = APIRouter(prefix="/users", tags=["User Management"])


# ── Request / Response Schemas ────────────────────────────────────────────────

class UserCreateRequest(BaseModel):
    username: str
    password: str
    email: str = ""
    role: str = "user"

    @field_validator("role")
    @classmethod
    def validate_role(cls, v):
        if v not in ("admin", "user"):
            raise ValueError("role must be 'admin' or 'user'")
        return v


class UserUpdateRequest(BaseModel):
    email: Optional[str] = None
    role: Optional[str] = None
    is_active: Optional[bool] = None
    password: Optional[str] = None

    @field_validator("role")
    @classmethod
    def validate_role(cls, v):
        if v is not None and v not in ("admin", "user"):
            raise ValueError("role must be 'admin' or 'user'")
        return v


class ChangePasswordRequest(BaseModel):
    current_password: str
    new_password: str


# ── Routes ────────────────────────────────────────────────────────────────────

@router.get("", summary="List all users (admin)")
async def list_users(_: dict = Security(require_admin)):
    db = get_user_db()
    users = await db.list_users()
    return {"users": [u.to_dict() for u in users], "total": len(users)}


@router.post(
    "",
    summary="Create a new user (admin)",
    status_code=201,
    responses={
        201: {
            "description": "User created successfully",
            "content": {
                "application/json": {
                    "example": {
                        "user": {
                            "username": "alice",
                            "role": "user",
                            "email": "alice@example.com",
                            "is_active": True,
                            "created_at": "2025-03-26T10:00:00Z",
                        },
                        "message": "User created successfully",
                    }
                }
            },
        },
        400: {"description": "username and password are required"},
        403: {"description": "Admin access required"},
        409: {"description": "Username already exists"},
    },
)
async def create_user(
    body: UserCreateRequest,
    _: dict = Security(require_admin),
):
    db = get_user_db()
    if not body.username or not body.password:
        raise HTTPException(status_code=400, detail="username and password are required")
    try:
        user = await db.create_user(
            username=body.username,
            password=body.password,
            role=body.role,
            email=body.email,
        )
    except IntegrityError:
        raise HTTPException(status_code=409, detail=f"Username '{body.username}' already exists")

    return {"user": user.to_dict(), "message": "User created successfully"}


@router.get("/me", summary="Get current user info")
async def get_me(current_user: dict = Security(get_current_user)):
    db = get_user_db()
    user = await db.get_user_by_username(current_user["username"])
    if not user:
        # Fallback for ENV-only users not in DB
        return {
            "user": {
                "username": current_user["username"],
                "role": current_user.get("role", "user"),
                "email": "",
                "is_active": True,
            }
        }
    return {"user": user.to_dict()}


@router.put("/me/password", summary="Change own password")
async def change_own_password(
    body: ChangePasswordRequest,
    current_user: dict = Security(get_current_user),
):
    db = get_user_db()
    user = await db.verify_password(current_user["username"], body.current_password)
    if not user:
        raise HTTPException(status_code=400, detail="Current password is incorrect")
    if len(body.new_password) < 6:
        raise HTTPException(status_code=400, detail="New password must be at least 6 characters")
    await db.update_user(user.id, password=body.new_password)
    return {"message": "Password updated successfully"}


@router.post("/me/avatar", summary="Upload or replace avatar for the current user")
async def upload_my_avatar(
    file: UploadFile = File(...),
    current_user: dict = Security(get_current_user),
):
    # Validate content-type
    content_type = file.content_type or ""
    if content_type not in _ALLOWED_MIME:
        raise HTTPException(
            status_code=status.HTTP_415_UNSUPPORTED_MEDIA_TYPE,
            detail=f"Unsupported file type '{content_type}'. Allowed: jpeg, png, gif, webp.",
        )

    # Read and validate size
    data = await file.read()
    if len(data) > _MAX_AVATAR_BYTES:
        raise HTTPException(
            status_code=status.HTTP_413_REQUEST_ENTITY_TOO_LARGE,
            detail="Avatar file must not exceed 2 MB.",
        )

    db = get_user_db()
    user = await db.get_user_by_username(current_user["username"])
    if not user:
        raise HTTPException(status_code=404, detail="User not found")

    ext = _ALLOWED_MIME[content_type]
    filename = f"{user.id}{ext}"
    avatars = _avatars_dir()

    # Remove any previously stored avatar files for this user
    for old in avatars.glob(f"{user.id}.*"):
        try:
            old.unlink()
        except OSError:
            pass

    dest = avatars / filename
    dest.write_bytes(data)

    avatar_url = f"/avatars/{filename}"
    await db.update_user(user.id, avatar_url=avatar_url)
    logger.info(f"Avatar updated for user '{user.username}': {avatar_url}")
    return {"avatar_url": avatar_url, "message": "Avatar uploaded successfully"}


@router.delete("/me/avatar", summary="Remove avatar for the current user")
async def delete_my_avatar(current_user: dict = Security(get_current_user)):
    db = get_user_db()
    user = await db.get_user_by_username(current_user["username"])
    if not user:
        raise HTTPException(status_code=404, detail="User not found")

    avatars = _avatars_dir()
    for old in avatars.glob(f"{user.id}.*"):
        try:
            old.unlink()
        except OSError:
            pass

    await db.update_user(user.id, avatar_url="")
    return {"message": "Avatar removed successfully"}


@router.get("/{user_id}", summary="Get user by ID (admin)")
async def get_user(user_id: str, _: dict = Security(require_admin)):
    db = get_user_db()
    user = await db.get_user_by_id(user_id)
    if not user:
        raise HTTPException(status_code=404, detail="User not found")
    return {"user": user.to_dict()}


@router.put("/{user_id}", summary="Update user (admin)")
async def update_user(
    user_id: str,
    body: UserUpdateRequest,
    _: dict = Security(require_admin),
):
    db = get_user_db()
    existing = await db.get_user_by_id(user_id)
    if not existing:
        raise HTTPException(status_code=404, detail="User not found")

    kwargs = {}
    if body.email is not None:
        kwargs["email"] = body.email
    if body.role is not None:
        kwargs["role"] = body.role
    if body.is_active is not None:
        kwargs["is_active"] = body.is_active
    if body.password is not None:
        if len(body.password) < 6:
            raise HTTPException(status_code=400, detail="密码长度不能少于6位")
        kwargs["password"] = body.password

    user = await db.update_user(user_id, **kwargs)
    return {"user": user.to_dict(), "message": "User updated successfully"}


@router.delete("/{user_id}", summary="Delete user (admin)")
async def delete_user(
    user_id: str,
    current_admin: dict = Security(require_admin),
):
    db = get_user_db()
    existing = await db.get_user_by_id(user_id)
    if not existing:
        raise HTTPException(status_code=404, detail="User not found")
    # Prevent admin from deleting themselves
    if existing.username == current_admin["username"]:
        raise HTTPException(status_code=400, detail="Cannot delete your own account")
    await db.delete_user(user_id)
    return {"message": f"User '{existing.username}' deleted successfully"}

