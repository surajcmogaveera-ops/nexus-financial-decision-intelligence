-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateTable
CREATE TABLE "users" (
    "id" UUID NOT NULL,
    "email" VARCHAR(320) NOT NULL,
    "display_name" VARCHAR(200),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "financial_profiles" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "display_name" VARCHAR(200),
    "currency" CHAR(3) NOT NULL DEFAULT 'INR',
    "monthly_income" DECIMAL(18,2),
    "monthly_expenses" DECIMAL(18,2),
    "monthly_debt_payments" DECIMAL(18,2),
    "liquid_savings" DECIMAL(18,2),
    "investments" DECIMAL(18,2),
    "monthly_investment_contribution" DECIMAL(18,2),
    "essential_monthly_expenses" DECIMAL(18,2),
    "profile_metadata" JSONB NOT NULL DEFAULT '{}',
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "financial_profiles_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "income_sources" (
    "id" UUID NOT NULL,
    "financial_profile_id" UUID NOT NULL,
    "name" VARCHAR(200) NOT NULL,
    "amount" DECIMAL(18,2) NOT NULL,
    "frequency" VARCHAR(20) NOT NULL,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "income_sources_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "expense_categories" (
    "id" UUID NOT NULL,
    "financial_profile_id" UUID NOT NULL,
    "category" VARCHAR(100) NOT NULL,
    "name" VARCHAR(200) NOT NULL,
    "amount" DECIMAL(18,2) NOT NULL,
    "frequency" VARCHAR(20) NOT NULL DEFAULT 'monthly',
    "is_essential" BOOLEAN NOT NULL DEFAULT false,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "expense_categories_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "debts" (
    "id" UUID NOT NULL,
    "financial_profile_id" UUID NOT NULL,
    "name" VARCHAR(200) NOT NULL,
    "outstanding_amount" DECIMAL(18,2) NOT NULL,
    "monthly_payment" DECIMAL(18,2) NOT NULL,
    "payment_frequency" VARCHAR(20) NOT NULL DEFAULT 'monthly',
    "interest_rate" DECIMAL(9,6),
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "debts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "assets" (
    "id" UUID NOT NULL,
    "financial_profile_id" UUID NOT NULL,
    "name" VARCHAR(200) NOT NULL,
    "asset_type" VARCHAR(100) NOT NULL,
    "current_value" DECIMAL(18,2) NOT NULL,
    "is_liquid" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "assets_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "investments" (
    "id" UUID NOT NULL,
    "financial_profile_id" UUID NOT NULL,
    "name" VARCHAR(200) NOT NULL,
    "investment_type" VARCHAR(100) NOT NULL,
    "current_value" DECIMAL(18,2) NOT NULL,
    "monthly_contribution" DECIMAL(18,2),
    "is_liquid" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "investments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "goals" (
    "id" UUID NOT NULL,
    "financial_profile_id" UUID NOT NULL,
    "name" VARCHAR(200) NOT NULL,
    "target_amount" DECIMAL(18,2) NOT NULL,
    "current_allocated_amount" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "target_date" DATE,
    "months_remaining" INTEGER,
    "monthly_contribution" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "funding_source" VARCHAR(200),
    "return_assumption" DECIMAL(12,8),
    "priority" INTEGER NOT NULL DEFAULT 1,
    "status" VARCHAR(20) NOT NULL DEFAULT 'active',
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "goals_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "scenarios" (
    "id" UUID NOT NULL,
    "financial_profile_id" UUID NOT NULL,
    "goal_id" UUID,
    "name" VARCHAR(200) NOT NULL,
    "description" TEXT,
    "scenario_type" VARCHAR(100) NOT NULL,
    "input_changes" JSONB NOT NULL DEFAULT '{}',
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "scenarios_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "scenario_results" (
    "id" UUID NOT NULL,
    "scenario_id" UUID NOT NULL,
    "result_data" JSONB NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "scenario_results_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "financial_snapshots" (
    "id" UUID NOT NULL,
    "financial_profile_id" UUID NOT NULL,
    "captured_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "snapshot_data" JSONB NOT NULL,
    "metadata" JSONB,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "financial_snapshots_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "evidence_sources" (
    "id" UUID NOT NULL,
    "name" VARCHAR(200) NOT NULL,
    "publisher" VARCHAR(200),
    "domain" VARCHAR(253),
    "source_type" VARCHAR(50) NOT NULL,
    "source_url" TEXT,
    "reliability" JSONB,
    "last_checked_at" TIMESTAMPTZ(6),
    "fresh_until" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "evidence_sources_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "evidence_documents" (
    "id" UUID NOT NULL,
    "source_id" UUID,
    "title" VARCHAR(500) NOT NULL,
    "canonical_url" TEXT,
    "published_at" TIMESTAMPTZ(6),
    "fresh_until" TIMESTAMPTZ(6),
    "content_metadata" JSONB,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "evidence_documents_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "evidence_chunks" (
    "id" UUID NOT NULL,
    "document_id" UUID NOT NULL,
    "chunk_index" INTEGER NOT NULL,
    "content" TEXT NOT NULL,
    "token_count" INTEGER,
    "metadata" JSONB,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "evidence_chunks_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ai_analyses" (
    "id" UUID NOT NULL,
    "user_id" UUID,
    "financial_profile_id" UUID,
    "scenario_id" UUID,
    "provider" VARCHAR(100),
    "model" VARCHAR(200),
    "prompt_version" VARCHAR(100),
    "status" VARCHAR(30) NOT NULL DEFAULT 'pending',
    "response_data" JSONB,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completed_at" TIMESTAMPTZ(6),

    CONSTRAINT "ai_analyses_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "verification_results" (
    "id" UUID NOT NULL,
    "ai_analysis_id" UUID NOT NULL,
    "scenario_id" UUID,
    "status" VARCHAR(30) NOT NULL,
    "verifier_version" VARCHAR(100),
    "details" JSONB NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "verification_results_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "market_data" (
    "id" UUID NOT NULL,
    "symbol" VARCHAR(100) NOT NULL,
    "market" VARCHAR(100),
    "source" VARCHAR(200) NOT NULL,
    "value" DECIMAL(24,8) NOT NULL,
    "observed_at" TIMESTAMPTZ(6) NOT NULL,
    "fresh_until" TIMESTAMPTZ(6),
    "source_metadata" JSONB,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "market_data_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "audit_logs" (
    "id" UUID NOT NULL,
    "user_id" UUID,
    "action" VARCHAR(100) NOT NULL,
    "entity_type" VARCHAR(100) NOT NULL,
    "entity_id" VARCHAR(200),
    "details" JSONB,
    "occurred_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "audit_logs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "users_email_key" ON "users"("email");

-- CreateIndex
CREATE UNIQUE INDEX "financial_profiles_user_id_key" ON "financial_profiles"("user_id");

-- CreateIndex
CREATE INDEX "income_sources_financial_profile_id_idx" ON "income_sources"("financial_profile_id");

-- CreateIndex
CREATE INDEX "expense_categories_financial_profile_id_idx" ON "expense_categories"("financial_profile_id");

-- CreateIndex
CREATE UNIQUE INDEX "expense_categories_financial_profile_id_category_name_key" ON "expense_categories"("financial_profile_id", "category", "name");

-- CreateIndex
CREATE INDEX "debts_financial_profile_id_idx" ON "debts"("financial_profile_id");

-- CreateIndex
CREATE INDEX "assets_financial_profile_id_idx" ON "assets"("financial_profile_id");

-- CreateIndex
CREATE INDEX "investments_financial_profile_id_idx" ON "investments"("financial_profile_id");

-- CreateIndex
CREATE INDEX "goals_financial_profile_id_idx" ON "goals"("financial_profile_id");

-- CreateIndex
CREATE INDEX "scenarios_financial_profile_id_idx" ON "scenarios"("financial_profile_id");

-- CreateIndex
CREATE INDEX "scenarios_goal_id_idx" ON "scenarios"("goal_id");

-- CreateIndex
CREATE INDEX "scenario_results_scenario_id_idx" ON "scenario_results"("scenario_id");

-- CreateIndex
CREATE INDEX "financial_snapshots_financial_profile_id_captured_at_idx" ON "financial_snapshots"("financial_profile_id", "captured_at" DESC);

-- CreateIndex
CREATE INDEX "evidence_sources_domain_idx" ON "evidence_sources"("domain");

-- CreateIndex
CREATE INDEX "evidence_sources_source_type_idx" ON "evidence_sources"("source_type");

-- CreateIndex
CREATE INDEX "evidence_documents_source_id_idx" ON "evidence_documents"("source_id");

-- CreateIndex
CREATE UNIQUE INDEX "evidence_chunks_document_id_chunk_index_key" ON "evidence_chunks"("document_id", "chunk_index");

-- CreateIndex
CREATE INDEX "ai_analyses_user_id_created_at_idx" ON "ai_analyses"("user_id", "created_at" DESC);

-- CreateIndex
CREATE INDEX "ai_analyses_financial_profile_id_created_at_idx" ON "ai_analyses"("financial_profile_id", "created_at" DESC);

-- CreateIndex
CREATE INDEX "ai_analyses_scenario_id_idx" ON "ai_analyses"("scenario_id");

-- CreateIndex
CREATE INDEX "verification_results_ai_analysis_id_created_at_idx" ON "verification_results"("ai_analysis_id", "created_at" DESC);

-- CreateIndex
CREATE INDEX "verification_results_scenario_id_idx" ON "verification_results"("scenario_id");

-- CreateIndex
CREATE UNIQUE INDEX "market_data_symbol_source_observed_at_key" ON "market_data"("symbol", "source", "observed_at");

-- CreateIndex
CREATE INDEX "audit_logs_user_id_occurred_at_idx" ON "audit_logs"("user_id", "occurred_at" DESC);

-- CreateIndex
CREATE INDEX "audit_logs_entity_type_entity_id_idx" ON "audit_logs"("entity_type", "entity_id");

-- AddForeignKey
ALTER TABLE "financial_profiles" ADD CONSTRAINT "financial_profiles_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "income_sources" ADD CONSTRAINT "income_sources_financial_profile_id_fkey" FOREIGN KEY ("financial_profile_id") REFERENCES "financial_profiles"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "expense_categories" ADD CONSTRAINT "expense_categories_financial_profile_id_fkey" FOREIGN KEY ("financial_profile_id") REFERENCES "financial_profiles"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "debts" ADD CONSTRAINT "debts_financial_profile_id_fkey" FOREIGN KEY ("financial_profile_id") REFERENCES "financial_profiles"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "assets" ADD CONSTRAINT "assets_financial_profile_id_fkey" FOREIGN KEY ("financial_profile_id") REFERENCES "financial_profiles"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "investments" ADD CONSTRAINT "investments_financial_profile_id_fkey" FOREIGN KEY ("financial_profile_id") REFERENCES "financial_profiles"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "goals" ADD CONSTRAINT "goals_financial_profile_id_fkey" FOREIGN KEY ("financial_profile_id") REFERENCES "financial_profiles"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "scenarios" ADD CONSTRAINT "scenarios_financial_profile_id_fkey" FOREIGN KEY ("financial_profile_id") REFERENCES "financial_profiles"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "scenarios" ADD CONSTRAINT "scenarios_goal_id_fkey" FOREIGN KEY ("goal_id") REFERENCES "goals"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "scenario_results" ADD CONSTRAINT "scenario_results_scenario_id_fkey" FOREIGN KEY ("scenario_id") REFERENCES "scenarios"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "financial_snapshots" ADD CONSTRAINT "financial_snapshots_financial_profile_id_fkey" FOREIGN KEY ("financial_profile_id") REFERENCES "financial_profiles"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "evidence_documents" ADD CONSTRAINT "evidence_documents_source_id_fkey" FOREIGN KEY ("source_id") REFERENCES "evidence_sources"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "evidence_chunks" ADD CONSTRAINT "evidence_chunks_document_id_fkey" FOREIGN KEY ("document_id") REFERENCES "evidence_documents"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ai_analyses" ADD CONSTRAINT "ai_analyses_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ai_analyses" ADD CONSTRAINT "ai_analyses_financial_profile_id_fkey" FOREIGN KEY ("financial_profile_id") REFERENCES "financial_profiles"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ai_analyses" ADD CONSTRAINT "ai_analyses_scenario_id_fkey" FOREIGN KEY ("scenario_id") REFERENCES "scenarios"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "verification_results" ADD CONSTRAINT "verification_results_ai_analysis_id_fkey" FOREIGN KEY ("ai_analysis_id") REFERENCES "ai_analyses"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "verification_results" ADD CONSTRAINT "verification_results_scenario_id_fkey" FOREIGN KEY ("scenario_id") REFERENCES "scenarios"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "audit_logs" ADD CONSTRAINT "audit_logs_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Keep raw monetary inputs non-negative at the database boundary.
-- Prisma schema syntax does not yet model PostgreSQL CHECK constraints.
ALTER TABLE "financial_profiles"
  ADD CONSTRAINT "financial_profiles_monthly_income_nonnegative" CHECK ("monthly_income" IS NULL OR "monthly_income" >= 0),
  ADD CONSTRAINT "financial_profiles_monthly_expenses_nonnegative" CHECK ("monthly_expenses" IS NULL OR "monthly_expenses" >= 0),
  ADD CONSTRAINT "financial_profiles_monthly_debt_payments_nonnegative" CHECK ("monthly_debt_payments" IS NULL OR "monthly_debt_payments" >= 0),
  ADD CONSTRAINT "financial_profiles_liquid_savings_nonnegative" CHECK ("liquid_savings" IS NULL OR "liquid_savings" >= 0),
  ADD CONSTRAINT "financial_profiles_investments_nonnegative" CHECK ("investments" IS NULL OR "investments" >= 0),
  ADD CONSTRAINT "financial_profiles_monthly_investment_contribution_nonnegative" CHECK ("monthly_investment_contribution" IS NULL OR "monthly_investment_contribution" >= 0),
  ADD CONSTRAINT "financial_profiles_essential_monthly_expenses_nonnegative" CHECK ("essential_monthly_expenses" IS NULL OR "essential_monthly_expenses" >= 0);
ALTER TABLE "income_sources" ADD CONSTRAINT "income_sources_amount_nonnegative" CHECK ("amount" >= 0);
ALTER TABLE "expense_categories" ADD CONSTRAINT "expense_categories_amount_nonnegative" CHECK ("amount" >= 0);
ALTER TABLE "debts"
  ADD CONSTRAINT "debts_outstanding_amount_nonnegative" CHECK ("outstanding_amount" >= 0),
  ADD CONSTRAINT "debts_monthly_payment_nonnegative" CHECK ("monthly_payment" >= 0),
  ADD CONSTRAINT "debts_interest_rate_nonnegative" CHECK ("interest_rate" IS NULL OR "interest_rate" >= 0);
ALTER TABLE "assets" ADD CONSTRAINT "assets_current_value_nonnegative" CHECK ("current_value" >= 0);
ALTER TABLE "investments"
  ADD CONSTRAINT "investments_current_value_nonnegative" CHECK ("current_value" >= 0),
  ADD CONSTRAINT "investments_monthly_contribution_nonnegative" CHECK ("monthly_contribution" IS NULL OR "monthly_contribution" >= 0);
ALTER TABLE "goals"
  ADD CONSTRAINT "goals_target_amount_nonnegative" CHECK ("target_amount" >= 0),
  ADD CONSTRAINT "goals_current_allocation_nonnegative" CHECK ("current_allocated_amount" >= 0),
  ADD CONSTRAINT "goals_monthly_contribution_nonnegative" CHECK ("monthly_contribution" >= 0),
  ADD CONSTRAINT "goals_return_assumption_nonnegative" CHECK ("return_assumption" IS NULL OR "return_assumption" >= 0),
  ADD CONSTRAINT "goals_priority_positive" CHECK ("priority" >= 1),
  ADD CONSTRAINT "goals_months_remaining_nonnegative" CHECK ("months_remaining" IS NULL OR "months_remaining" >= 0);
ALTER TABLE "market_data" ADD CONSTRAINT "market_data_value_nonnegative" CHECK ("value" >= 0);
ALTER TABLE "evidence_chunks"
  ADD CONSTRAINT "evidence_chunks_chunk_index_nonnegative" CHECK ("chunk_index" >= 0),
  ADD CONSTRAINT "evidence_chunks_token_count_nonnegative" CHECK ("token_count" IS NULL OR "token_count" >= 0);
