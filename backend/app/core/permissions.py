from dataclasses import dataclass
from typing import Dict, List, Optional

from fastapi import Depends, HTTPException, Request
from jose import JWTError, jwt
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select

from app.core.config import settings
from app.core.security import ALGORITHM
from app.db.base import get_db
from app.models.all_models import User, SystemConfig

@dataclass
class PermissionContext:
    email: Optional[str]
    is_super_admin: bool
    allowed_modules: List[str]

PERMISSION_CONFIG_KEY = "permission_config_v1"


def _normalize_email(email: str) -> str:
    return (email or "").strip().lower()


def _normalize_permission_config(
    super_admin_emails: List[str],
    business_line_members: Dict[str, List[str]]
) -> Dict[str, object]:
    return {
        "super_admin_emails": [(_normalize_email(e)) for e in (super_admin_emails or []) if _normalize_email(e)],
        "business_line_members": {
            str(k): [(_normalize_email(i)) for i in (v or []) if _normalize_email(i)]
            for k, v in (business_line_members or {}).items()
        }
    }


def _default_permission_config() -> Dict[str, object]:
    return _normalize_permission_config(
        settings.SUPER_ADMIN_EMAILS or [],
        settings.BUSINESS_LINE_MEMBERS or {}
    )


async def get_permission_config(db: AsyncSession) -> Dict[str, object]:
    result = await db.execute(select(SystemConfig).where(SystemConfig.config_key == PERMISSION_CONFIG_KEY))
    row = result.scalars().first()
    if not row or not isinstance(row.config_value, dict):
        return _default_permission_config()
    value = row.config_value or {}
    return _normalize_permission_config(
        value.get("super_admin_emails") or [],
        value.get("business_line_members") or {}
    )


async def update_permission_config(
    db: AsyncSession,
    super_admin_emails: List[str],
    business_line_members: Dict[str, List[str]]
) -> Dict[str, object]:
    cfg = _normalize_permission_config(super_admin_emails, business_line_members)
    result = await db.execute(select(SystemConfig).where(SystemConfig.config_key == PERMISSION_CONFIG_KEY))
    row = result.scalars().first()
    if not row:
        row = SystemConfig(config_key=PERMISSION_CONFIG_KEY, config_value=cfg)
        db.add(row)
    else:
        row.config_value = cfg
    await db.commit()
    return cfg


async def _resolve_email_from_request(request: Request, db: AsyncSession) -> Optional[str]:
    header_email = _normalize_email(request.headers.get("x-user-email") or "")
    if header_email:
        return header_email

    auth_header = request.headers.get("authorization") or ""
    if not auth_header.lower().startswith("bearer "):
        return None
    token = auth_header.split(" ", 1)[1].strip()
    if not token:
        return None
    try:
        payload = jwt.decode(token, settings.SECRET_KEY, algorithms=[ALGORITHM])
        sub = payload.get("sub")
        if not sub:
            return None
        user = await db.get(User, int(sub))
        if not user:
            return None
        return _normalize_email(user.email or "")
    except (JWTError, ValueError):
        return None


async def get_permission_context(
    request: Request,
    db: AsyncSession = Depends(get_db),
) -> PermissionContext:
    cfg = await get_permission_config(db)
    if not (cfg["super_admin_emails"] or cfg["business_line_members"]):
        return PermissionContext(email=None, is_super_admin=True, allowed_modules=[])

    email = await _resolve_email_from_request(request, db)
    if not email:
        raise HTTPException(status_code=401, detail="Unauthorized: missing user identity")

    super_admin_emails = set(cfg["super_admin_emails"])
    if email in super_admin_emails:
        return PermissionContext(email=email, is_super_admin=True, allowed_modules=[])

    allowed_modules: List[str] = []
    for module, users in cfg["business_line_members"].items():
        normalized = {_normalize_email(u) for u in (users or [])}
        if email in normalized:
            allowed_modules.append(module)

    if not allowed_modules:
        raise HTTPException(status_code=403, detail="Forbidden: no business line permission")

    return PermissionContext(email=email, is_super_admin=False, allowed_modules=allowed_modules)


def ensure_super_admin(ctx: PermissionContext = Depends(get_permission_context)) -> PermissionContext:
    if not ctx.is_super_admin:
        raise HTTPException(status_code=403, detail="Forbidden: super admin required")
    return ctx


def ensure_module_access(ctx: PermissionContext, module: str) -> None:
    if ctx.is_super_admin:
        return
    if module not in ctx.allowed_modules:
        raise HTTPException(status_code=403, detail=f"Forbidden: no access to module '{module}'")
