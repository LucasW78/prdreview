from typing import Optional

from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.future import select

from app.models.all_models import User
from app.schemas.user_schemas import UserCreate
from app.core.security import get_password_hash, verify_password

async def get_by_email(db: AsyncSession, email: str) -> Optional[User]:
    result = await db.execute(select(User).filter(User.email == email))
    return result.scalars().first()

async def authenticate(
    db: AsyncSession, email: str, password: str
) -> Optional[User]:
    user = await get_by_email(db, email)
    if not user:
        return None
    if not verify_password(password, user.hashed_password):
        return None
    return user

def is_active(user: User) -> bool:
    return user.is_active

async def create(db: AsyncSession, obj_in: UserCreate) -> User:
    db_obj = User(
        email=obj_in.email,
        hashed_password=get_password_hash(obj_in.password),
        is_active=True,
        is_superuser=False,
    )
    db.add(db_obj)
    await db.commit()
    await db.refresh(db_obj)
    return db_obj
