"""
Organization management routes for LightRAG API.

Endpoints:
  GET    /orgs                             - get org tree (all authenticated users)
  POST   /orgs                             - create org (system-admin or org-admin)
  GET    /orgs/my                          - current user's org membership
  GET    /orgs/{id}                        - get org detail
  PUT    /orgs/{id}                        - update org (system-admin or org-admin of subtree)
  DELETE /orgs/{id}                        - delete org (no children/members)
  GET    /orgs/{id}/members                - list members
  POST   /orgs/{id}/members               - add member
  PUT    /orgs/{id}/members/{username}     - change member role
  DELETE /orgs/{id}/members/{username}     - remove member
"""

from typing import Optional
from fastapi import APIRouter, HTTPException, Security
from pydantic import BaseModel, field_validator
from sqlite3 import IntegrityError

from lightrag.api.kb_db import get_kb_db
from lightrag.api.auth import get_current_user

router = APIRouter(prefix="/orgs", tags=["Organization Management"])


# ── Helpers ───────────────────────────────────────────────────────────────────


async def _can_manage_org(current_user: dict, org_id: str) -> bool:
    """Return True if the user may manage the given org.

    System admins always can. Org-admins can manage their own org and
    any descendant org.
    """
    if current_user.get("role") == "admin":
        return True
    db = get_kb_db()
    membership = await db.get_user_org(current_user["username"])
    if not membership or membership.role != "admin":
        return False
    # Org admin: allowed if target is own org or a descendant
    if membership.org_id == org_id:
        return True
    descendants = await db.get_descendant_ids(membership.org_id)
    return org_id in descendants


# ── Request Schemas ───────────────────────────────────────────────────────────


class OrgCreateRequest(BaseModel):
    name: str
    parent_id: Optional[str] = None
    description: str = ""


class OrgUpdateRequest(BaseModel):
    name: Optional[str] = None
    description: Optional[str] = None


class OrgMemberAddRequest(BaseModel):
    username: str
    role: str = "member"

    @field_validator("role")
    @classmethod
    def validate_role(cls, v):
        if v not in ("admin", "member"):
            raise ValueError("role must be 'admin' or 'member'")
        return v


class OrgMemberRoleRequest(BaseModel):
    role: str

    @field_validator("role")
    @classmethod
    def validate_role(cls, v):
        if v not in ("admin", "member"):
            raise ValueError("role must be 'admin' or 'member'")
        return v


# ── Routes: Org CRUD ──────────────────────────────────────────────────────────


@router.get("", summary="Get full organization tree")
async def get_org_tree(current_user: dict = Security(get_current_user)):
    db = get_kb_db()
    tree = await db.get_org_tree()
    return {"orgs": [o.to_dict() for o in tree], "total": len(tree)}


@router.get("/my", summary="Get current user's org membership")
async def get_my_org(current_user: dict = Security(get_current_user)):
    db = get_kb_db()
    membership = await db.get_user_org(current_user["username"])
    if not membership:
        return {"membership": None, "org": None}
    org = await db.get_org_by_id(membership.org_id)
    return {"membership": membership.to_dict(), "org": org.to_dict() if org else None}


@router.post(
    "",
    summary="Create organization",
    status_code=201,
    responses={
        201: {
            "description": "Organization created successfully",
            "content": {
                "application/json": {
                    "example": {
                        "org": {
                            "id": "org-uuid",
                            "name": "Engineering",
                            "parent_id": None,
                            "description": "Engineering department",
                            "created_at": "2025-03-26T10:00:00Z",
                        },
                        "message": "组织创建成功",
                    }
                }
            },
        },
        403: {"description": "Insufficient permissions"},
        404: {"description": "Parent organization not found"},
        409: {"description": "Organization name already exists"},
    },
)
async def create_org(
    body: OrgCreateRequest, current_user: dict = Security(get_current_user)
):
    db = get_kb_db()
    # Check permission: system admin or org-admin who can manage the parent
    if body.parent_id:
        if not await _can_manage_org(current_user, body.parent_id):
            raise HTTPException(status_code=403, detail="无权在该组织下创建子组织")
        parent = await db.get_org_by_id(body.parent_id)
        if not parent:
            raise HTTPException(status_code=404, detail="父组织不存在")
    elif current_user.get("role") != "admin":
        raise HTTPException(status_code=403, detail="只有系统管理员可以创建根组织")

    try:
        org = await db.create_org(
            name=body.name, parent_id=body.parent_id, description=body.description
        )
    except IntegrityError:
        raise HTTPException(status_code=409, detail=f"组织名 '{body.name}' 已存在")
    return {"org": org.to_dict(), "message": "组织创建成功"}


@router.get("/{org_id}", summary="Get org detail")
async def get_org(org_id: str, current_user: dict = Security(get_current_user)):
    db = get_kb_db()
    org = await db.get_org_by_id(org_id)
    if not org:
        raise HTTPException(status_code=404, detail="组织不存在")
    members = await db.list_org_members(org_id)
    return {"org": org.to_dict(), "members": [m.to_dict() for m in members]}


@router.put("/{org_id}", summary="Update org")
async def update_org(
    org_id: str, body: OrgUpdateRequest, current_user: dict = Security(get_current_user)
):
    if not await _can_manage_org(current_user, org_id):
        raise HTTPException(status_code=403, detail="无权修改该组织")
    db = get_kb_db()
    if not await db.get_org_by_id(org_id):
        raise HTTPException(status_code=404, detail="组织不存在")
    kwargs = {}
    if body.name is not None:
        kwargs["name"] = body.name
    if body.description is not None:
        kwargs["description"] = body.description
    org = await db.update_org(org_id, **kwargs)
    return {"org": org.to_dict(), "message": "组织更新成功"}


@router.delete("/{org_id}", summary="Delete org")
async def delete_org(org_id: str, current_user: dict = Security(get_current_user)):
    if not await _can_manage_org(current_user, org_id):
        raise HTTPException(status_code=403, detail="无权删除该组织")
    db = get_kb_db()
    if not await db.get_org_by_id(org_id):
        raise HTTPException(status_code=404, detail="组织不存在")
    result = await db.delete_org(org_id)
    if not result["ok"]:
        raise HTTPException(status_code=400, detail=result["reason"])
    return {"message": "组织删除成功"}


# ── Routes: Member Management ─────────────────────────────────────────────────


@router.get("/{org_id}/members", summary="List org members")
async def list_members(org_id: str, current_user: dict = Security(get_current_user)):
    db = get_kb_db()
    if not await db.get_org_by_id(org_id):
        raise HTTPException(status_code=404, detail="组织不存在")
    members = await db.list_org_members(org_id)
    return {"members": [m.to_dict() for m in members], "total": len(members)}


@router.post(
    "/{org_id}/members",
    summary="Add member to org",
    status_code=201,
    responses={
        201: {
            "description": "Member added successfully",
            "content": {
                "application/json": {
                    "example": {
                        "member": {
                            "username": "alice",
                            "org_id": "org-uuid",
                            "role": "member",
                            "joined_at": "2025-03-26T10:00:00Z",
                        },
                        "message": "成员添加成功",
                    }
                }
            },
        },
        403: {"description": "Insufficient permissions"},
        404: {"description": "Organization or user not found"},
    },
)
async def add_member(
    org_id: str,
    body: OrgMemberAddRequest,
    current_user: dict = Security(get_current_user),
):
    if not await _can_manage_org(current_user, org_id):
        raise HTTPException(status_code=403, detail="无权管理该组织成员")
    db = get_kb_db()
    if not await db.get_org_by_id(org_id):
        raise HTTPException(status_code=404, detail="组织不存在")
    # Verify the user exists
    from lightrag.api.user_db import get_user_db

    if not await get_user_db().get_user_by_username(body.username):
        raise HTTPException(status_code=404, detail=f"用户 '{body.username}' 不存在")
    result = await db.add_org_member(org_id, body.username, body.role)
    if not result["ok"]:
        raise HTTPException(status_code=409, detail=result["reason"])
    return {"member": result["member"].to_dict(), "message": "成员添加成功"}


@router.put("/{org_id}/members/{username}", summary="Update member role")
async def update_member_role(
    org_id: str,
    username: str,
    body: OrgMemberRoleRequest,
    current_user: dict = Security(get_current_user),
):
    if not await _can_manage_org(current_user, org_id):
        raise HTTPException(status_code=403, detail="无权管理该组织成员")
    db = get_kb_db()
    updated = await db.update_org_member_role(org_id, username, body.role)
    if not updated:
        raise HTTPException(status_code=404, detail="成员不存在")
    return {"message": f"已将 '{username}' 的角色更新为 '{body.role}'"}


@router.delete("/{org_id}/members/{username}", summary="Remove member from org")
async def remove_member(
    org_id: str, username: str, current_user: dict = Security(get_current_user)
):
    if not await _can_manage_org(current_user, org_id):
        raise HTTPException(status_code=403, detail="无权管理该组织成员")
    db = get_kb_db()
    removed = await db.remove_org_member(org_id, username)
    if not removed:
        raise HTTPException(status_code=404, detail="成员不存在")
    return {"message": f"已移除成员 '{username}'"}


# ── KB Operation Permissions (Phase C) ────────────────────────────────────────


class KBPermissionRequest(BaseModel):
    username: str
    permission: str  # 'read' | 'write'

    @field_validator("permission")
    @classmethod
    def validate_permission(cls, v):
        if v not in ("read", "write"):
            raise ValueError("permission must be 'read' or 'write'")
        return v


@router.get(
    "/{org_id}/kb-permissions", summary="List KB operation permissions for org members"
)
async def list_kb_permissions(
    org_id: str, current_user: dict = Security(get_current_user)
):
    """Return {username: ['read','write',...]} for all members of this org."""
    db = get_kb_db()
    if not await db.get_org_by_id(org_id):
        raise HTTPException(status_code=404, detail="组织不存在")
    perms = await db.list_org_member_kb_permissions(org_id)
    return {"permissions": perms}


@router.post(
    "/{org_id}/kb-permissions",
    summary="Grant KB permission to an org member",
    status_code=201,
    responses={
        201: {
            "description": "Permission granted successfully",
            "content": {
                "application/json": {
                    "example": {
                        "message": "权限授予成功",
                        "username": "alice",
                        "permission": "kb_write",
                    }
                }
            },
        },
        403: {"description": "Insufficient permissions"},
        404: {"description": "Organization or user not found"},
    },
)
async def grant_kb_permission(
    org_id: str,
    body: KBPermissionRequest,
    current_user: dict = Security(get_current_user),
):
    if not await _can_manage_org(current_user, org_id):
        raise HTTPException(status_code=403, detail="无权管理该组织的KB权限")
    db = get_kb_db()
    # Target user must be a member of this org
    membership = await db.get_user_org(body.username)
    if not membership or membership.org_id != org_id:
        raise HTTPException(
            status_code=400, detail=f"用户 '{body.username}' 不是该组织的成员"
        )
    result = await db.grant_kb_permission(
        body.username, body.permission, current_user["username"]
    )
    if not result["ok"]:
        raise HTTPException(status_code=409, detail=result["reason"])
    return {"message": f"已授予 '{body.username}' kb_{body.permission} 权限"}


@router.delete(
    "/{org_id}/kb-permissions/{username}/{permission}", summary="Revoke KB permission"
)
async def revoke_kb_permission(
    org_id: str,
    username: str,
    permission: str,
    current_user: dict = Security(get_current_user),
):
    if permission not in ("read", "write"):
        raise HTTPException(
            status_code=400, detail="permission 必须为 'read' 或 'write'"
        )
    if not await _can_manage_org(current_user, org_id):
        raise HTTPException(status_code=403, detail="无权管理该组织的KB权限")
    db = get_kb_db()
    removed = await db.revoke_kb_permission(username, permission)
    if not removed:
        raise HTTPException(
            status_code=404, detail=f"用户 '{username}' 没有 {permission} 权限"
        )
    return {"message": f"已撤销 '{username}' 的 kb_{permission} 权限"}
