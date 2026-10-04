"""Create initial NEXUS financial persistence tables.

Revision ID: 0001_initial
Revises:
"""

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

revision = "0001_initial"
down_revision = None
branch_labels = None
depends_on = None

UUID = postgresql.UUID(as_uuid=True)
JSONB = postgresql.JSONB(astext_type=sa.Text())
TIMESTAMP = sa.DateTime(timezone=True)


def _id_column() -> sa.Column:
    return sa.Column(
        "id", UUID, server_default=sa.text("gen_random_uuid()"), nullable=False
    )


def _timestamps() -> list[sa.Column]:
    return [
        sa.Column("created_at", TIMESTAMP, server_default=sa.func.now(), nullable=False),
        sa.Column("updated_at", TIMESTAMP, server_default=sa.func.now(), nullable=False),
    ]


def upgrade() -> None:
    op.create_table(
        "users",
        _id_column(),
        sa.Column("display_name", sa.String(length=200), nullable=False),
        sa.Column("email", sa.String(length=320), nullable=True),
        *_timestamps(),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_users")),
        sa.UniqueConstraint("email", name=op.f("uq_users_email")),
    )
    op.create_table(
        "financial_profiles",
        _id_column(),
        sa.Column("user_id", UUID, nullable=False),
        sa.Column("display_name", sa.String(length=200), nullable=True),
        sa.Column("currency", sa.String(length=3), nullable=False),
        sa.Column("profile_metadata", JSONB, server_default=sa.text("'{}'::jsonb"), nullable=False),
        *_timestamps(),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"], ondelete="CASCADE", name=op.f("fk_financial_profiles_user_id_users")),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_financial_profiles")),
        sa.UniqueConstraint("user_id", name=op.f("uq_financial_profiles_user_id")),
    )

    for table_name, fields in (
        ("income_sources", [
            sa.Column("name", sa.String(length=200), nullable=False),
            sa.Column("amount", sa.Numeric(18, 2), nullable=False),
            sa.Column("frequency", sa.String(length=20), nullable=False),
            sa.Column("is_active", sa.Boolean(), nullable=False),
            sa.CheckConstraint("amount >= 0", name=op.f("ck_income_sources_amount_nonnegative")),
        ]),
        ("expenses", [
            sa.Column("category", sa.String(length=100), nullable=False),
            sa.Column("name", sa.String(length=200), nullable=False),
            sa.Column("amount", sa.Numeric(18, 2), nullable=False),
            sa.Column("frequency", sa.String(length=20), nullable=False),
            sa.Column("is_essential", sa.Boolean(), nullable=False),
            sa.Column("is_active", sa.Boolean(), nullable=False),
            sa.CheckConstraint("amount >= 0", name=op.f("ck_expenses_amount_nonnegative")),
        ]),
        ("debts", [
            sa.Column("name", sa.String(length=200), nullable=False),
            sa.Column("principal_amount", sa.Numeric(18, 2), nullable=False),
            sa.Column("payment_amount", sa.Numeric(18, 2), nullable=False),
            sa.Column("payment_frequency", sa.String(length=20), nullable=False),
            sa.Column("interest_rate", sa.Numeric(9, 6), nullable=True),
            sa.Column("is_active", sa.Boolean(), nullable=False),
            sa.CheckConstraint("principal_amount >= 0", name=op.f("ck_debts_principal_nonnegative")),
            sa.CheckConstraint("payment_amount >= 0", name=op.f("ck_debts_payment_nonnegative")),
            sa.CheckConstraint("interest_rate IS NULL OR interest_rate >= 0", name=op.f("ck_debts_interest_nonnegative")),
        ]),
        ("assets", [
            sa.Column("name", sa.String(length=200), nullable=False),
            sa.Column("asset_type", sa.String(length=100), nullable=False),
            sa.Column("current_value", sa.Numeric(18, 2), nullable=False),
            sa.Column("is_liquid", sa.Boolean(), nullable=False),
            sa.CheckConstraint("current_value >= 0", name=op.f("ck_assets_value_nonnegative")),
        ]),
        ("investments", [
            sa.Column("name", sa.String(length=200), nullable=False),
            sa.Column("investment_type", sa.String(length=100), nullable=False),
            sa.Column("current_value", sa.Numeric(18, 2), nullable=False),
            sa.Column("monthly_contribution", sa.Numeric(18, 2), nullable=True),
            sa.Column("is_liquid", sa.Boolean(), nullable=False),
            sa.CheckConstraint("current_value >= 0", name=op.f("ck_investments_value_nonnegative")),
            sa.CheckConstraint("monthly_contribution IS NULL OR monthly_contribution >= 0", name=op.f("ck_investments_contribution_nonnegative")),
        ]),
        ("goals", [
            sa.Column("name", sa.String(length=200), nullable=False),
            sa.Column("target_amount", sa.Numeric(18, 2), nullable=False),
            sa.Column("current_allocated_amount", sa.Numeric(18, 2), nullable=False),
            sa.Column("target_date", sa.Date(), nullable=True),
            sa.Column("current_contribution", sa.Numeric(18, 2), nullable=False),
            sa.Column("funding_source", sa.String(length=200), nullable=True),
            sa.Column("return_assumption", sa.Numeric(12, 8), nullable=False),
            sa.Column("priority", sa.Integer(), nullable=False),
            sa.Column("status", sa.String(length=20), nullable=False),
            sa.CheckConstraint("target_amount >= 0", name=op.f("ck_goals_target_nonnegative")),
            sa.CheckConstraint("current_allocated_amount >= 0", name=op.f("ck_goals_allocation_nonnegative")),
            sa.CheckConstraint("current_contribution >= 0", name=op.f("ck_goals_contribution_nonnegative")),
            sa.CheckConstraint("return_assumption >= 0", name=op.f("ck_goals_return_nonnegative")),
            sa.CheckConstraint("priority >= 1", name=op.f("ck_goals_priority_positive")),
        ]),
        ("scenarios", [
            sa.Column("name", sa.String(length=200), nullable=False),
            sa.Column("description", sa.Text(), nullable=True),
            sa.Column("scenario_type", sa.String(length=100), nullable=False),
            sa.Column("input_changes", JSONB, server_default=sa.text("'{}'::jsonb"), nullable=False),
        ]),
    ):
        foreign_key_name = f"fk_{table_name}_financial_profile_id_financial_profiles"
        op.create_table(
            table_name,
            _id_column(),
            sa.Column("financial_profile_id", UUID, nullable=False),
            *fields,
            *_timestamps(),
            sa.ForeignKeyConstraint(
                ["financial_profile_id"],
                ["financial_profiles.id"],
                ondelete="CASCADE",
                name=op.f(foreign_key_name),
            ),
            sa.PrimaryKeyConstraint("id", name=op.f(f"pk_{table_name}")),
        )
        op.create_index(
            op.f(f"ix_{table_name}_financial_profile_id"),
            table_name,
            ["financial_profile_id"],
        )

    op.create_table(
        "scenario_results",
        _id_column(),
        sa.Column("scenario_id", UUID, nullable=False),
        sa.Column("baseline_snapshot", JSONB, nullable=False),
        sa.Column("scenario_snapshot", JSONB, nullable=False),
        sa.Column("derived_results", JSONB, nullable=False),
        sa.Column("delta_data", JSONB, nullable=False),
        sa.Column("goal_impact", JSONB, nullable=False),
        sa.Column("risk_flags", JSONB, nullable=False),
        sa.Column("evidence_references", JSONB, nullable=False),
        *_timestamps(),
        sa.ForeignKeyConstraint(["scenario_id"], ["scenarios.id"], ondelete="CASCADE", name=op.f("fk_scenario_results_scenario_id_scenarios")),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_scenario_results")),
    )
    op.create_index(op.f("ix_scenario_results_scenario_id"), "scenario_results", ["scenario_id"])


def downgrade() -> None:
    op.drop_index(op.f("ix_scenario_results_scenario_id"), table_name="scenario_results")
    op.drop_table("scenario_results")
    for table_name in ("scenarios", "goals", "investments", "assets", "debts", "expenses", "income_sources"):
        op.drop_index(op.f(f"ix_{table_name}_financial_profile_id"), table_name=table_name)
        op.drop_table(table_name)
    op.drop_table("financial_profiles")
    op.drop_table("users")
