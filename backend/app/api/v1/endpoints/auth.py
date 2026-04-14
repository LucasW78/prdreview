from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.ext.asyncio import AsyncSession
from fastapi.security import OAuth2PasswordRequestForm
from typing import Any
from datetime import timedelta

from app.core import security
from app.core.config import settings
from app.db.base import get_db
from app.services import user_service
from app.schemas import user_schemas
from app.core.permissions import (
    get_permission_context,
    PermissionContext,
    ensure_super_admin,
    get_permission_config,
    update_permission_config,
)

router = APIRouter()

@router.post("/login/access-token", response_model=user_schemas.Token)
async def login_access_token(
    db: AsyncSession = Depends(get_db), form_data: OAuth2PasswordRequestForm = Depends()
) -> Any:
    """
    OAuth2 compatible token login, get an access token for future requests
    """
    user = await user_service.authenticate(
        db, email=form_data.username, password=form_data.password
    )
    if not user:
        raise HTTPException(status_code=400, detail="Incorrect email or password")
    elif not user_service.is_active(user):
        raise HTTPException(status_code=400, detail="Inactive user")
    
    access_token_expires = timedelta(minutes=settings.ACCESS_TOKEN_EXPIRE_MINUTES)
    return {
        "access_token": security.create_access_token(
            user.id, expires_delta=access_token_expires
        ),
        "token_type": "bearer",
    }

@router.post("/register", response_model=user_schemas.User)
async def register_user(
    *,
    db: AsyncSession = Depends(get_db),
    user_in: user_schemas.UserCreate,
) -> Any:
    """
    Create new user.
    """
    user = await user_service.get_by_email(db, email=user_in.email)
    if user:
        raise HTTPException(
            status_code=400,
            detail="The user with this username already exists in the system.",
        )
    user = await user_service.create(db, obj_in=user_in)
    return user

@router.get("/permissions")
async def get_permissions(ctx: PermissionContext = Depends(get_permission_context)) -> Any:
    return {
        "role": "super_admin" if ctx.is_super_admin else "business",
        "email": ctx.email,
        "allowed_modules": ctx.allowed_modules
    }

@router.get("/permission-config")
async def get_permission_config_api(
    _: PermissionContext = Depends(ensure_super_admin),
    db: AsyncSession = Depends(get_db)
) -> Any:
    return await get_permission_config(db)

@router.put("/permission-config")
async def update_permission_config_api(
    payload: dict,
    _: PermissionContext = Depends(ensure_super_admin),
    db: AsyncSession = Depends(get_db)
) -> Any:
    super_admin_emails = payload.get("super_admin_emails") or []
    business_line_members = payload.get("business_line_members") or {}
    if not isinstance(super_admin_emails, list):
        raise HTTPException(status_code=422, detail="super_admin_emails must be a list")
    if not isinstance(business_line_members, dict):
        raise HTTPException(status_code=422, detail="business_line_members must be an object")
    return await update_permission_config(db, super_admin_emails, business_line_members)
