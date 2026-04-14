"""add system configs table

Revision ID: b7a1c2d3e4f5
Revises: 9f2c1d4a7b3e
Create Date: 2026-04-14 20:30:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = 'b7a1c2d3e4f5'
down_revision: Union[str, None] = '9f2c1d4a7b3e'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        'system_configs',
        sa.Column('id', sa.Integer(), nullable=False),
        sa.Column('config_key', sa.String(), nullable=False),
        sa.Column('config_value', sa.JSON(), nullable=False),
        sa.Column('updated_at', sa.DateTime(), nullable=True),
        sa.Column('created_at', sa.DateTime(), nullable=True),
        sa.PrimaryKeyConstraint('id')
    )
    op.create_index(op.f('ix_system_configs_config_key'), 'system_configs', ['config_key'], unique=True)
    op.create_index(op.f('ix_system_configs_id'), 'system_configs', ['id'], unique=False)


def downgrade() -> None:
    op.drop_index(op.f('ix_system_configs_id'), table_name='system_configs')
    op.drop_index(op.f('ix_system_configs_config_key'), table_name='system_configs')
    op.drop_table('system_configs')
