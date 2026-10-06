import { createHash } from "node:crypto";
import { addMoney, decimalToMinorUnits, minorUnitsToMoney, subtractMoney } from "../financial/money.js";
import { parseFinancialTwinRequest } from "../financial/schemas.js";
import { calculateFinancialTwin } from "../financial/service.js";
import { Provenance } from "../financial/constants.js";
import { calculateScenarioDelta } from "../financial/engine/financialMetrics.js";
import { sumDecimalAmounts } from "../financial/engine/goalProgress.js";
import { calculateProfileRiskFlags, calculateRiskFlags } from "../financial/engine/riskFlags.js";
import { calculationEvidenceId, canonicalizeEvidenceValue, domainCalculationEvidenceId } from "../financial/engine/evidenceIdentity.js";
import type { CalculationEvidence, FinancialProfile, FinancialTwin, Money, RiskCalculationEvidence, RiskFlag } from "../financial/types.js";
import { createFinancialCalculationEvidence } from "../financial/engine/calculationEvidence.js";
import type { ScenarioDelta, ScenarioInput, ScenarioMetricDelta, ScenarioResult, ScenarioState } from "./types.js";

const scenarioAssumptions: Record<ScenarioInput["type"], string[]> = {
  INVESTMENT_CHANGE: ["Investment contribution reduces cash available for a short-term goal; investment returns are not assumed."],
  INCOME_SHOCK: ["Only the specified income change is applied; no secondary or market responses are assumed."],
  EXPENSE_CHANGE: ["The specified change is recurring monthly expense; no other spending response is assumed."],
  RENT_CHANGE: ["Rent change is mapped to monthlyExpenses because the Financial Twin has no separate rent field."],
  EMERGENCY_EXPENSE: ["The expense is modeled as a one-time reduction in liquid savings and does not change recurring expenses."],
  DEBT_CHANGE: ["Only monthly debt payments change; no debt balance or amortization is modeled."],
  GOAL_CHANGE: ["Goal projections use the existing Financial Engine and its no-return assumption."],
  MARKET_STRESS: ["Market stress is a deterministic hypothetical adjustment, not a forecast."],
};

function cloneProfile(profile: FinancialProfile): FinancialProfile {
  return { ...profile, goals: profile.goals.map((goal) => ({ ...goal })) };
}

function applyBasisPointChange(value: Money, basisPoints: number): Money {
  const minor = decimalToMinorUnits(value, "scenario basis");
  const numerator = minor * BigInt(basisPoints);
  const denominator = 10000n;
  let quotient = numerator / denominator;
  const remainder = numerator % denominator;
  const absRemainder = remainder < 0n ? -remainder : remainder;
  if (absRemainder * 2n > denominator || (absRemainder * 2n === denominator && quotient % 2n !== 0n)) {
    quotient += numerator < 0n ? -1n : 1n;
  }
  return minorUnitsToMoney(minor + quotient);
}

function requireNonNegativeChange(value: Money, field: string): Money {
  if (decimalToMinorUnits(value, field, true) < 0n) {
    throw new TypeError(`${field} scenario would produce a negative value`);
  }
  return value;
}

function transform(profile: FinancialProfile, input: ScenarioInput): { raw: FinancialProfile; changed: string[] } {
  const raw = cloneProfile(profile);
  const changed: string[] = [];
  switch (input.type) {
    case "INVESTMENT_CHANGE":
      raw.monthlyInvestmentContribution = input.monthlyInvestmentContribution;
      changed.push("monthlyInvestmentContribution");
      break;
    case "INCOME_SHOCK": {
      const delta = input.amountDelta ?? ("percentageBasisPoints" in input
        ? applyBasisPointChange(raw.monthlyIncome, input.percentageBasisPoints!)
        : "0");
      raw.monthlyIncome = requireNonNegativeChange(
        input.amountDelta ? addMoney(raw.monthlyIncome, delta) : delta,
        "monthlyIncome",
      );
      changed.push("monthlyIncome");
      break;
    }
    case "EXPENSE_CHANGE": {
      const delta = input.amountDelta ?? ("percentageBasisPoints" in input
        ? applyBasisPointChange(raw.monthlyExpenses, input.percentageBasisPoints!)
        : "0");
      raw.monthlyExpenses = requireNonNegativeChange(
        input.amountDelta ? addMoney(raw.monthlyExpenses, delta) : delta,
        "monthlyExpenses",
      );
      changed.push("monthlyExpenses");
      break;
    }
    case "RENT_CHANGE":
      raw.monthlyExpenses = requireNonNegativeChange(addMoney(raw.monthlyExpenses, input.monthlyRentDelta), "monthlyExpenses");
      changed.push("monthlyExpenses");
      break;
    case "EMERGENCY_EXPENSE":
      raw.liquidSavings = requireNonNegativeChange(subtractMoney(raw.liquidSavings, input.amount), "liquidSavings");
      changed.push("liquidSavings");
      break;
    case "DEBT_CHANGE":
      raw.monthlyDebtPayments = requireNonNegativeChange(addMoney(raw.monthlyDebtPayments, input.monthlyPaymentDelta), "monthlyDebtPayments");
      changed.push("monthlyDebtPayments");
      break;
    case "GOAL_CHANGE": {
      const matches = raw.goals.map((goal, index) => ({ goal, index })).filter(({ goal }) => goal.name === input.goalName);
      if (matches.length !== 1) throw new TypeError(matches.length === 0
        ? `Goal '${input.goalName}' was not found`
        : `Goal name '${input.goalName}' is ambiguous`);
      const { goal, index } = matches[0]!;
      if (input.targetAmount !== undefined) { goal.targetAmount = input.targetAmount; changed.push(`goals[${index}].targetAmount`); }
      if (input.currentAllocatedAmount !== undefined) { goal.currentAllocatedAmount = input.currentAllocatedAmount; changed.push(`goals[${index}].currentAllocatedAmount`); }
      if (input.monthsRemaining !== undefined) {
        delete goal.targetDate;
        goal.monthsRemaining = input.monthsRemaining;
        changed.push(`goals[${index}].monthsRemaining`);
      }
      break;
    }
    case "MARKET_STRESS":
      break;
  }
  return { raw, changed };
}

function metricDelta(baseline: number | Money | null, scenario: number | Money | null): ScenarioMetricDelta {
  return calculateScenarioDelta(baseline, scenario);
}

function metricTotal(goals: FinancialTwin["derived"]["goals"], field: "projectedAmount" | "projectedGoalShortfall"): Money | null {
  return goals.length ? sumDecimalAmounts(goals.map((goal) => goal[field])) : null;
}

function buildDelta(baseline: FinancialTwin, scenario: FinancialTwin): ScenarioDelta {
  const shortfall = metricDelta(metricTotal(baseline.derived.goals, "projectedGoalShortfall"), metricTotal(scenario.derived.goals, "projectedGoalShortfall"));
  return {
    monthlySurplus: metricDelta(baseline.derived.monthlySurplus, scenario.derived.monthlySurplus),
    availableMonthlyCashFlow: metricDelta(baseline.derived.availableMonthlyCashFlow, scenario.derived.availableMonthlyCashFlow),
    savingsRate: metricDelta(baseline.derived.savingsRate, scenario.derived.savingsRate),
    debtToIncome: metricDelta(baseline.derived.debtToIncome, scenario.derived.debtToIncome),
    emergencyCoverageMonths: metricDelta(baseline.derived.emergencyCoverageMonths, scenario.derived.emergencyCoverageMonths),
    currentFundingGap: metricDelta(baseline.derived.currentFundingGap, scenario.derived.currentFundingGap),
    projectedAmount: metricDelta(metricTotal(baseline.derived.goals, "projectedAmount"), metricTotal(scenario.derived.goals, "projectedAmount")),
    projectedGoalShortfall: shortfall,
    liquidityImpact: metricDelta(baseline.raw.liquidSavings, scenario.raw.liquidSavings),
    additionalScenarioShortfall: typeof shortfall.delta === "string" ? shortfall.delta : null,
  };
}

function emptyDelta(): ScenarioDelta {
  const unavailable = { delta: null, percentageDelta: null };
  return {
    monthlySurplus: unavailable, availableMonthlyCashFlow: unavailable, savingsRate: unavailable,
    debtToIncome: unavailable, emergencyCoverageMonths: unavailable, currentFundingGap: unavailable,
    projectedAmount: unavailable, projectedGoalShortfall: unavailable, liquidityImpact: unavailable,
    additionalScenarioShortfall: null,
  };
}

function scenarioId(profile: FinancialProfile, input: ScenarioInput, asOfDate: string): string {
  const canonical = canonicalizeEvidenceValue({ profile, input, asOfDate });
  return `SCEN-${createHash("sha256").update(JSON.stringify(canonical)).digest("hex").slice(0, 16).toUpperCase()}`;
}

function transformationEvidence(profile: FinancialProfile, transformed: FinancialProfile, fields: string[]): RiskCalculationEvidence[] {
  return fields.map((field) => {
    const baseKey = field.split(".").at(-1)!;
    const indexMatch = /goals\[(\d+)\]/.exec(field);
    const baselineValue = indexMatch
      ? profile.goals[Number(indexMatch[1])]![baseKey as keyof (typeof profile.goals)[number]]
      : profile[baseKey as keyof FinancialProfile];
    const scenarioValue = indexMatch
      ? transformed.goals[Number(indexMatch[1])]![baseKey as keyof (typeof transformed.goals)[number]]
      : transformed[baseKey as keyof FinancialProfile];
    const valuesAreNumeric = typeof baselineValue === "string" && typeof scenarioValue === "string";
    const partial = {
      metric: field,
      expression: "scenario_raw_value_transformed_from_baseline",
      baselineValue: valuesAreNumeric ? baselineValue as Money : null,
      scenarioValue: valuesAreNumeric ? scenarioValue as Money : null,
      result: true,
      provenance: Provenance.COMPUTED,
    };
    return { ...partial, evidenceId: calculationEvidenceId({
      metric: partial.metric, expression: partial.expression,
      baseline: partial.baselineValue, scenario: partial.scenarioValue,
      result: partial.result, provenance: partial.provenance,
    }) };
  });
}

function mergeFlags(...groups: RiskFlag[][]): RiskFlag[] {
  const merged = new Map<string, RiskFlag>();
  const rank = { low: 0, medium: 1, high: 2 };
  for (const flag of groups.flat()) {
    const existing = merged.get(flag.type);
    if (!existing) merged.set(flag.type, { ...flag, evidence: [...flag.evidence] });
    else merged.set(flag.type, {
      ...existing,
      severity: rank[flag.severity] > rank[existing.severity] ? flag.severity : existing.severity,
      evidence: [...new Set([...existing.evidence, ...flag.evidence])],
      details: { ...existing.details, ...flag.details },
    });
  }
  return [...merged.values()];
}

function profileRiskEvidence(flags: RiskFlag[]): RiskCalculationEvidence[] {
  return flags.flatMap((flag) => {
    const recordFor = (metric: string, expression: string, baselineValue: RiskCalculationEvidence["baselineValue"], scenarioValue: RiskCalculationEvidence["scenarioValue"]): RiskCalculationEvidence => ({
      metric, expression, baselineValue, scenarioValue, result: true, provenance: Provenance.COMPUTED,
      evidenceId: calculationEvidenceId({ metric, expression, baseline: baselineValue, scenario: scenarioValue, result: true, provenance: Provenance.COMPUTED }),
    });
    if (flag.trigger === "scenario_monthly_surplus < 0") {
      return [recordFor("monthly_surplus", "scenario_monthly_surplus < 0", "0", flag.details.monthlySurplus as string)];
    }
    if (flag.trigger.startsWith("projectedAmount < targetAmount")) {
      return [recordFor("projected_goal_shortfall", "projected_amount < target_amount within the selected horizon", null, flag.details.projectedGoalShortfall as string)];
    }
    if (flag.type === "MISSING_DATA") {
      return [recordFor("emergency_coverage_months", "essential_monthly_expenses is unavailable", null, null)];
    }
    return [];
  });
}

function makeTwin(raw: FinancialProfile, derived: FinancialTwin["derived"]): FinancialTwin {
  const derivedProvenance = Object.fromEntries(Object.keys(derived).map((key) => [key, Provenance.COMPUTED])) as FinancialTwin["provenance"]["derived"];
  const twin: FinancialTwin = {
    raw, derived,
    provenance: {
      raw: {},
      derived: derivedProvenance,
      goalFields: [],
      assumptions: Provenance.ASSUMPTION,
    },
    riskFlags: [], evidence: createFinancialCalculationEvidence(raw, derived, new Date().toISOString()), assumptions: [], calculatedAt: "",
  };
  twin.riskFlags = calculateProfileRiskFlags(twin);
  return twin;
}

function scenarioDeltaEvidence(baseline: FinancialTwin, scenario: FinancialTwin, delta: ScenarioDelta, timestamp: string): CalculationEvidence[] {
  const metrics = ["monthlySurplus", "availableMonthlyCashFlow", "savingsRate", "debtToIncome", "emergencyCoverageMonths", "currentFundingGap", "projectedAmount", "projectedGoalShortfall", "liquidityImpact"] as const;
  return metrics.map((metric) => {
    const baselineValue = metric === "liquidityImpact" ? baseline.raw.liquidSavings : metric === "projectedAmount" || metric === "projectedGoalShortfall"
      ? metricTotal(baseline.derived.goals, metric) : baseline.derived[metric];
    const scenarioValue = metric === "liquidityImpact" ? scenario.raw.liquidSavings : metric === "projectedAmount" || metric === "projectedGoalShortfall"
      ? metricTotal(scenario.derived.goals, metric) : scenario.derived[metric];
    const output = delta[metric];
    const formula = `${metric} delta = scenario value - baseline value; percentageDelta = delta / abs(baseline) × 100 (null when unavailable or baseline is zero)`;
    const inputs = { baseline: baselineValue, scenario: scenarioValue };
    const evidenceId = domainCalculationEvidenceId({ metric: `scenarioDelta.${metric}`, inputs, formula, output, provenance: Provenance.COMPUTED });
    return { metric: `scenarioDelta.${metric}`, expression: formula, baselineValue, scenarioValue, result: true,
      provenance: Provenance.COMPUTED, evidenceId, type: "CALCULATION", id: evidenceId, calculationId: evidenceId,
      inputs, formula, output, timestamp };
  });
}

/** Transform raw inputs immutably, then recalculate both states through the existing Financial Engine. */
export function runScenario(
  baselineRequest: ReturnType<typeof parseFinancialTwinRequest>,
  input: ScenarioInput,
): ScenarioResult {
  const { profile, asOfDate } = baselineRequest.request;
  const baselineTwin = calculateFinancialTwin(baselineRequest);
  const unsupported = input.type === "MARKET_STRESS";
  const transformed = unsupported ? { raw: cloneProfile(profile), changed: [] as string[] } : transform(profile, input);
  const scenarioRaw = transformed.raw;
  const scenarioParsed = parseFinancialTwinRequest({ profile: scenarioRaw, asOfDate });
  const scenarioDerived = unsupported
    ? baselineTwin.derived
    : calculateFinancialTwin(scenarioParsed).derived;
  const scenarioTwin = makeTwin(scenarioRaw, scenarioDerived);
  const comparison = unsupported ? { flags: [], calculations: [] } : calculateRiskFlags(
    baselineTwin.derived,
    scenarioDerived,
    {
      baselineLiquidSavings: profile.liquidSavings,
      scenarioLiquidSavings: scenarioRaw.liquidSavings,
      baselineGoalFeasible: baselineTwin.derived.goals.length > 0 && baselineTwin.derived.goals.every((goal) => goal.feasible === true),
      scenarioGoalFeasible: scenarioDerived.goals.length > 0 && scenarioDerived.goals.every((goal) => goal.feasible === true),
    },
  );
  const profileFlags = unsupported ? [] : scenarioTwin.riskFlags;
  const riskFlags = mergeFlags(comparison.flags, profileFlags);
  const transformEvidence = unsupported ? [] : transformationEvidence(profile, scenarioRaw, transformed.changed);
  const calculatedAt = new Date().toISOString();
  const delta = unsupported ? emptyDelta() : buildDelta(baselineTwin, scenarioTwin);
  const evidence = [...new Map(
    [...baselineTwin.evidence, ...scenarioTwin.evidence,
      ...scenarioDeltaEvidence(baselineTwin, scenarioTwin, delta, calculatedAt),
      ...transformEvidence, ...comparison.calculations, ...profileRiskEvidence(profileFlags)]
      .map((record) => [record.evidenceId, record]),
  ).values()];
  const rawProvenance = { ...baselineTwin.provenance.raw };
  const goalFieldProvenance = baselineTwin.provenance.goalFields.map((fields) => ({ ...fields }));
  for (const field of transformed.changed) {
    const goalFieldMatch = /^goals\[(\d+)\]\.([^.]+)$/.exec(field);
    if (goalFieldMatch) {
      const goalIndex = Number(goalFieldMatch[1]);
      const goalField = goalFieldMatch[2] as keyof (typeof scenarioRaw.goals)[number];
      if (goalFieldProvenance[goalIndex]) goalFieldProvenance[goalIndex]![goalField] = Provenance.COMPUTED;
      continue;
    }
    const rawField = field as keyof typeof rawProvenance;
    if (rawField in rawProvenance) rawProvenance[rawField] = Provenance.COMPUTED;
  }
  const scenarioState: ScenarioState = {
    raw: scenarioRaw,
    provenance: {
      raw: rawProvenance,
      derived: scenarioTwin.provenance.derived,
      goalFields: goalFieldProvenance,
      assumptions: Provenance.ASSUMPTION,
    },
  };
  return {
    scenarioId: scenarioId(profile, input, asOfDate),
    scenarioType: input.type,
    status: unsupported ? "UNSUPPORTED" : "COMPLETED",
    baselineState: { raw: cloneProfile(profile), provenance: structuredClone(baselineTwin.provenance) },
    scenarioState,
    baselineMetrics: baselineTwin.derived,
    scenarioMetrics: scenarioDerived,
    delta,
    riskFlags,
    evidence,
    assumptions: [
      ...scenarioAssumptions[input.type],
      ...(unsupported ? ["The current Financial Twin has only an aggregate investments balance and no asset exposure detail; market valuation impact is unsupported and no investment value is changed."] : []),
    ],
    provenance: {
      scenarioTransform: Provenance.COMPUTED,
      scenarioDerived: Provenance.COMPUTED,
      assumptions: Provenance.ASSUMPTION,
    },
    calculatedAt,
  };
}
