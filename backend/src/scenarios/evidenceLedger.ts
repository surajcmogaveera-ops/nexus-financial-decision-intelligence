import { Provenance, type Provenance as ProvenanceType } from "../financial/constants.js";
import type { CalculationEvidence, RiskCalculationEvidence, RiskFlag } from "../financial/types.js";
import type { ScenarioDelta } from "./types.js";
import type { ScenarioEvidenceRepository } from "./repository.js";

export interface LedgerEvidenceReference {
  id: string;
  statement: string;
  provenance: Extract<ProvenanceType, "COMPUTED">;
  calculation: CalculationEvidence;
  supportingCalculations: CalculationEvidence[];
  riskEvidenceIds: string[];
}

export interface EvidenceLedgerClaim {
  id: string;
  claim: string;
  provenance: ProvenanceType;
  evidence: LedgerEvidenceReference[];
}

export interface EvidenceLedger {
  scenarioId: string;
  claims: EvidenceLedgerClaim[];
  assumptions: { provenance: Extract<ProvenanceType, "ASSUMPTION">; items: string[] };
}

const METRICS = [
  ["monthlySurplus", "Monthly surplus"],
  ["availableMonthlyCashFlow", "Available monthly cash flow"],
  ["savingsRate", "Savings rate"],
  ["debtToIncome", "Debt burden"],
  ["emergencyCoverageMonths", "Emergency coverage"],
  ["currentFundingGap", "Current goal funding gap"],
  ["projectedAmount", "Projected goal amount"],
  ["projectedGoalShortfall", "Projected goal shortfall"],
  ["liquidityImpact", "Liquid savings"],
] as const;

const RISK_METRICS: Record<RiskFlag["type"], keyof ScenarioDelta | null> = {
  LIQUIDITY_REDUCTION: "liquidityImpact",
  GOAL_SHORTFALL: null,
  NEGATIVE_SURPLUS: "monthlySurplus",
  HIGHER_DEBT_BURDEN: "debtToIncome",
  EMERGENCY_COVERAGE_REDUCTION: "emergencyCoverageMonths",
  MISSING_DATA: "emergencyCoverageMonths",
};

function riskMetric(flag: RiskFlag): keyof ScenarioDelta | null {
  if (flag.type === "GOAL_SHORTFALL") {
    return flag.trigger === "scenario_goal_gap > baseline_goal_gap" ? "currentFundingGap" : "projectedGoalShortfall";
  }
  return RISK_METRICS[flag.type];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function isCalculation(value: RiskCalculationEvidence): value is CalculationEvidence {
  return value.type === "CALCULATION" && typeof value.id === "string" &&
    value.id === value.evidenceId && value.id === value.calculationId &&
    /^CALC-[A-F0-9]{12}$/.test(value.id) && value.provenance === Provenance.COMPUTED &&
    typeof value.formula === "string" && isRecord(value.inputs) &&
    typeof value.timestamp === "string" && Number.isFinite(Date.parse(value.timestamp)) && "output" in value;
}

function sign(value: unknown): -1 | 0 | 1 | null {
  if (typeof value !== "number" && typeof value !== "string") return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed < 0 ? -1 : parsed > 0 ? 1 : 0 : null;
}

function createReference(calculation: CalculationEvidence, records: CalculationEvidence[], flagIds: string[] = []): LedgerEvidenceReference {
  const goalCalculation = calculation.metric.startsWith("scenarioDelta.")
    ? calculation.metric.slice("scenarioDelta.".length)
    : "";
  const relatedMetric = goalCalculation === "projectedGoalShortfall"
    ? ["projectedGoalShortfall", "projectedAmount"]
    : goalCalculation ? [goalCalculation] : [];
  const related = records.filter((record) => record !== calculation && (
    record.metric === goalCalculation || (record.metric.startsWith("goals[") &&
      relatedMetric.some((metric) => record.metric.endsWith(`.${metric}`)))
  ));
  const deltaOutput = isRecord(calculation.output) ? calculation.output.delta : null;
  return {
    id: calculation.evidenceId,
    statement: isRecord(calculation.output)
      ? deltaOutput === null
        ? "A comparable change is unavailable; the calculation inputs and result are retained."
        : `${String(deltaOutput)} change; ${String((calculation.output as { percentageDelta?: unknown }).percentageDelta ?? "unavailable")}% relative change`
      : `${String(calculation.output)}`,
    provenance: Provenance.COMPUTED,
    calculation,
    supportingCalculations: related,
    riskEvidenceIds: flagIds,
  };
}

/** Builds an audit view from persisted Node results only; it never calls the Financial Engine. */
export async function getEvidenceLedger(
  userId: string,
  scenarioId: string,
  repository: ScenarioEvidenceRepository,
): Promise<EvidenceLedger | null> {
  const stored = await repository.findOwnedResult(userId, scenarioId);
  if (!isRecord(stored)) return null;
  const scenario = isRecord(stored.scenario) ? stored.scenario : null;
  const baseline = isRecord(stored.baseline) ? stored.baseline : null;
  const rawBaseline = baseline && isRecord(baseline.raw) ? baseline.raw : null;
  const currency = rawBaseline && typeof rawBaseline.currency === "string" ? rawBaseline.currency : "";
  const delta = isRecord(stored.delta) ? stored.delta as unknown as ScenarioDelta : null;
  const evidenceList = scenario && Array.isArray(scenario.evidence) ? scenario.evidence : [];
  const records = evidenceList.filter(isRecord) as unknown as RiskCalculationEvidence[];
  const calculations = records.filter(isCalculation);
  const flags = Array.isArray(stored.riskFlags) ? stored.riskFlags.filter((flag): flag is Record<string, unknown> =>
    isRecord(flag) && typeof flag.type === "string" && typeof flag.trigger === "string" &&
    Array.isArray(flag.evidence) && flag.evidence.every((id) => typeof id === "string"),
  ) as unknown as RiskFlag[] : [];
  const claims: EvidenceLedgerClaim[] = [];

  if (delta) for (const [metric, label] of METRICS) {
    const record = calculations.find((item) => item.metric === `scenarioDelta.${metric}`);
    if (!record || !isRecord(record.output)) continue;
    const amount = sign(record.output.delta);
    if (amount === null || amount === 0) continue;
    const increases = amount > 0;
    const claim = `${label} ${increases ? "increases" : "decreases"}.`;
    const evidenceIds = flags.filter((flag) => riskMetric(flag) === metric).flatMap((flag) => flag.evidence);
    const ref = createReference(record, calculations, evidenceIds);
    const values = isRecord(record.inputs) ? record.inputs : {};
    const unit = ["monthlySurplus", "availableMonthlyCashFlow", "currentFundingGap", "projectedAmount", "projectedGoalShortfall", "liquidityImpact"].includes(metric) && currency
      ? ` ${currency}` : "";
    ref.statement = `Baseline: ${String(values.baseline)}${unit}; scenario: ${String(values.scenario)}${unit}; change: ${String(record.output.delta)}${unit} (${String(record.output.percentageDelta ?? "unavailable")}%).`;
    claims.push({ id: `CLAIM-${record.evidenceId.slice(5)}-${metric}`, claim, provenance: Provenance.COMPUTED, evidence: [ref] });
  }

  // Risk claims reuse the H15 metric delta calculation and link the original H14 comparison IDs.
  for (const flag of flags) {
    const metric = riskMetric(flag);
    if (!metric) continue;
    const record = calculations.find((item) => item.metric === `scenarioDelta.${metric}`);
    if (!record || claims.some((claim) => claim.evidence.some((item) => item.calculation.id === record.id))) continue;
    claims.push({
      id: `CLAIM-RISK-${flag.type}-${record.evidenceId.slice(5)}`,
      claim: `NEXUS detected ${flag.type.toLowerCase().replaceAll("_", " ")}.`,
      provenance: Provenance.COMPUTED,
      evidence: [createReference(record, calculations, flag.evidence)],
    });
  }

  const assumptions = Array.isArray(stored.assumptions)
    ? stored.assumptions.filter((item): item is string => typeof item === "string")
    : [];
  return { scenarioId, claims, assumptions: { provenance: Provenance.ASSUMPTION, items: assumptions } };
}
