"""add review snapshot fields

Revision ID: 9f2c1d4a7b3e
Revises: 5e8d7c6b9a2f
Create Date: 2026-04-13 16:30:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = '9f2c1d4a7b3e'
down_revision: Union[str, None] = '5e8d7c6b9a2f'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column('review_tasks', sa.Column('result_snapshot', sa.JSON(), nullable=True))
    op.add_column('review_tasks', sa.Column('snapshot_history', sa.JSON(), nullable=False, server_default=sa.text("'[]'")))
    op.add_column('review_tasks', sa.Column('error_message', sa.Text(), nullable=True))
    op.add_column('review_tasks', sa.Column('processing_time_sec', sa.Float(), nullable=True))
    op.add_column('review_tasks', sa.Column('updated_at', sa.DateTime(), nullable=True))


def downgrade() -> None:
    op.drop_column('review_tasks', 'updated_at')
    op.drop_column('review_tasks', 'processing_time_sec')
    op.drop_column('review_tasks', 'error_message')
    op.drop_column('review_tasks', 'snapshot_history')
    op.drop_column('review_tasks', 'result_snapshot')
