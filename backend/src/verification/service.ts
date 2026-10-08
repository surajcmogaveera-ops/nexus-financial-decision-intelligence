import { parseAiAnalysisResponse, validateAiAnalysisRequest } from "../ai/schemas.js";
import type { AiAnalysisRequest, AiAnalysisResponse } from "../ai/types.js";
import type { RiskFlag } from "../financial/types.js";
import type { AiVerificationResult, VerificationCheck, VerificationIssue } from "./types.js";

const NUMBER_PATTERN = /(?<![\p{L}\p{N}_])(?:₹\s*)?-?\d[\d,]*(?:\.\d+)?(?:\s*(?:%|lakhs?|crores?|thousand|million|billion))?(?:\s*(?:\/\s*(?:month|year)|per\s+(?:month|year)|(?:monthly|annually|annual)))?/giu;
const GUARANTEE_PATTERNS = [
  /\bguarantee(?:d)?\b/iu,
  /\bdefinitely\b/iu,
  /\bcertain(?:ly)?\b/iu,
  /\brisk\s*[- ]\s*free\b/iu,
  /\bno\s+risk\b/iu,
  /\bassured(?:\s+return)?\b/iu,
  /\bcannot\s+lose\b/iu,
  /\bzero\s+risk\b/iu,
  /\bwill\s+definitely\b/iu,
];

const ACTION_VALUE_FIELDS = [
  { field: "monthlyInvestmentContribution", aliases: ["monthly investment contribution", "investment contribution"] },
  { field: "monthlyIncome", aliases: ["monthly income", "income"] },
  { field: "monthlyExpenses", aliases: ["monthly expenses", "expenses", "monthly spending", "spending"] },
  { field: "monthlyDebtPayments", aliases: ["monthly debt payments", "debt payments"] },
  { field: "liquidSavings", aliases: ["liquid savings"] },
] as const;

const METRIC_SPECS = [
  { name: "monthly surplus", aliases: ["monthly surplus", "surplus"], metric: "monthlySurplus" },
  { name: "savings rate", aliases: ["savings rate"], metric: "savingsRate" },
  { name: "debt burden", aliases: ["debt burden", "debt-to-income", "debt to income"], metric: "debtToIncome" },
  { name: "emergency coverage", aliases: ["emergency coverage", "emergency fund coverage"], metric: "emergencyCoverageMonths" },
  { name: "current funding gap", aliases: ["current funding gap", "funding gap"], metric: "currentFundingGap" },
  { name: "required monthly contribution", aliases: ["required monthly contribution"], metric: "requiredMonthlyContribution" },
  { name: "projected amount", aliases: ["projected amount"], metric: "projectedAmount" },
  { name: "projected goal shortfall", aliases: ["projected goal shortfall", "goal shortfall", "shortfall"], metric: "projectedGoalShortfall" },
] as const;

/**
 * Validates a Node-owned AI contract against the exact request and deterministic
 * context that were supplied to the AI. It is a computation only: no provider,
 * network, persistence, or financial calculations are invoked.
 */
export function verifyAiAnalysis(responseValue: unknown, contextValue: AiAnalysisRequest): AiVerificationResult {
  const context = cloneContext(contextValue);
  const contextIssues: VerificationIssue[] = [];
  try {
    validateAiAnalysisRequest(context);
  } catch {
    contextIssues.push(issue("SCHEMA_INVALID", "context", "The authoritative verification context is invalid."));
  }

  let parsed: AiAnalysisResponse | null = null;
  const schemaIssues = [...contextIssues];
  if (!schemaIssues.length) {
    try { parsed = parseAiAnalysisResponse(responseValue, context.requestId); }
    catch { schemaIssues.push(issue("SCHEMA_INVALID", null, "The AI analysis does not match the existing response contract.")); }
  }
  const schema = check(schemaIssues);
  const notRun = (): VerificationCheck => ({ status: "NOT_RUN", issues: [] });
  if (!parsed || !context) {
    const checks = {
      schema, numeric: notRun(), evidenceReferences: notRun(), scenarioConsistency: notRun(),
      unsupportedClaims: notRun(), guaranteeLanguage: notRun(),
    };
    return finish(checks, []);
  }

  const strings = collectAnalysisText(parsed);
  const numeric = check(checkNumericClaims(strings, context, parsed.evidenceRefs));
  const evidenceReferences = check(checkEvidenceReferences(parsed.evidenceRefs, context));
  const scenarioConsistency = check(checkScenarioConsistency(parsed, context, strings));
  const unsupportedClaims = check(checkUnsupportedClaims(strings, context, parsed.evidenceRefs));
  const guaranteeLanguage = check(checkGuaranteeLanguage(strings));
  const limitations = context.scenario.status === "UNSUPPORTED"
    ? ["The deterministic engine marks this scenario unsupported; verification cannot establish its financial impact."]
    : [];
  return finish({ schema, numeric, evidenceReferences, scenarioConsistency, unsupportedClaims, guaranteeLanguage }, limitations);
}

function finish(checks: AiVerificationResult["checks"], limitations: string[]): AiVerificationResult {
  const order = [checks.schema, checks.numeric, checks.evidenceReferences, checks.scenarioConsistency, checks.unsupportedClaims, checks.guaranteeLanguage];
  const issues = order.flatMap((item) => item.issues);
  const flagged = order.some((item) => item.status === "FLAGGED");
  return { status: flagged ? "FLAGGED" : limitations.length ? "PASS_WITH_LIMITATION" : "PASS", checks, issues, limitations };
}

function checkNumericClaims(texts: Array<{ field: string; text: string }>, context: AiAnalysisRequest, evidenceRefs: string[]): VerificationIssue[] {
  const issues: VerificationIssue[] = [];
  for (const item of texts) {
    const sentences = item.text.split(/(?<=[.!?;])\s+/u);
    for (const sentence of sentences) {
      const claims = numericTokens(sentence);
      if (!claims.length) continue;
      const metricSpecs = METRIC_SPECS.filter((spec) => spec.aliases.some((alias) => new RegExp(`\\b${escapeRegex(alias)}\\b`, "iu").test(sentence)));
      const actionSpecs = ACTION_VALUE_FIELDS.filter((spec) => spec.aliases.some((alias) => new RegExp(`\\b${escapeRegex(alias)}\\b`, "iu").test(sentence)));
      if (metricSpecs.length || actionSpecs.length) {
        if (claims.length !== 1 || metricSpecs.length + actionSpecs.length !== 1) {
          issues.push(issue("UNSUPPORTED_NUMERIC_CLAIM", item.field, "The numeric claim cannot be linked unambiguously to one authoritative metric or scenario value."));
          continue;
        }
        if (metricSpecs.length === 1) {
          const spec = metricSpecs[0]!;
          const expected = expectedMetricValues(spec.metric, context, sentence);
          if (!expected.length || !expected.some((value) => numericClaimMatches(claims[0]!, value, spec.metric))) {
            issues.push(issue("NUMERIC_MISMATCH", item.field, `The stated ${spec.name} does not match the corresponding authoritative ${/\b(?:baseline|before|prior)\b/iu.test(sentence) ? "baseline" : "scenario"} value.`));
          }
        } else {
          const spec = actionSpecs[0]!;
          const baseline = context.baseline.raw[spec.field as keyof typeof context.baseline.raw];
          const scenario = context.scenario.raw[spec.field as keyof typeof context.scenario.raw];
          const isBaseline = /\b(?:baseline|before|prior)\b/iu.test(sentence);
          const expected = isBaseline ? baseline : scenario;
          if (typeof expected !== "string" || !numericClaimMatches(claims[0]!, expected, spec.field)) {
            issues.push(issue("SCENARIO_MISMATCH", item.field, `The stated ${spec.field} does not match the authoritative ${isBaseline ? "baseline" : "scenario"} value.`));
          }
        }
        continue;
      }

      const exactAssumption = item.field.startsWith("assumptions[") && context.assumptions.some((assumption) => assumption.trim().toLocaleLowerCase() === sentence.trim().toLocaleLowerCase());
      if (!exactAssumption && !supportsCitedNumber(claims[0]!, sentence, context, new Set(evidenceRefs))) {
        issues.push(issue("UNSUPPORTED_NUMERIC_CLAIM", item.field, `The numeric claim “${claims[0]!.raw}” is not tied to a matching authoritative metric, explicit assumption, or cited evidence.`));
      }
    }
  }
  return dedupeIssues(issues);
}

function supportsCitedNumber(claim: NumericClaim, sentence: string, context: AiAnalysisRequest, refs: Set<string>): boolean {
  const lower = sentence.toLowerCase();
  for (const evidence of [...context.evidence, ...context.baseline.evidence, ...context.scenario.evidence]) {
    if (!refs.has(evidence.evidenceId)) continue;
    const metric = METRIC_SPECS.find((spec) => spec.aliases.some((alias) => lower.includes(alias)));
    if (!metric || !evidence.metric.toLowerCase().includes(metric.metric.toLowerCase())) continue;
    const value = evidence.output ?? evidence.scenarioValue ?? evidence.baselineValue;
    if (numericValueMatches(claim, value)) return true;
  }
  for (const item of context.retrievedContext) {
    if (!refs.has(item.chunkId)) continue;
    const evidenceText = item.content.toLowerCase();
    const claimTopics = ["return", "yield", "tax", "market", "surplus", "shortfall", "contribution", "income", "expense", "debt", "coverage"];
    if (!claimTopics.some((topic) => lower.includes(topic) && evidenceText.includes(topic))) continue;
    if (numericTokens(item.content).some((evidenceNumber) => numericValueMatches(claim, evidenceNumber.raw))) return true;
  }
  return false;
}

function checkEvidenceReferences(references: string[], context: AiAnalysisRequest): VerificationIssue[] {
  const supplied = new Set<string>();
  for (const list of [context.evidence, context.baseline.evidence, context.scenario.evidence]) {
    for (const evidence of list) supplied.add(evidence.evidenceId);
  }
  for (const item of context.retrievedContext) supplied.add(item.chunkId);
  return dedupeIssues(references.filter((reference) => !supplied.has(reference)).map((reference) =>
    issue("UNKNOWN_EVIDENCE_REFERENCE", "evidenceRefs", `Evidence reference “${reference}” was not supplied in this request-scoped context.`),
  ));
}

function checkScenarioConsistency(response: AiAnalysisResponse, context: AiAnalysisRequest, texts: Array<{ field: string; text: string }>): VerificationIssue[] {
  const issues: VerificationIssue[] = [];
  if (stableJson(response.riskFlags) !== stableJson(context.riskFlags)) {
    issues.push(issue("SCENARIO_MISMATCH", "riskFlags", "AI risk flags differ from the authoritative Node scenario risk flags."));
  }
  const shortfall = context.scenario.derived.goals.some((goal) => positive(goal.projectedGoalShortfall));
  const feasibleFailure = context.scenario.derived.goals.some((goal) => goal.feasible === false);
  for (const item of texts) {
    const scenarioMentions: Record<string, string[]> = {
      INVESTMENT_CHANGE: ["investment change", "investment contribution change", "contribution change"],
      INCOME_SHOCK: ["income shock", "income reduction", "income decrease", "income increase"],
      EXPENSE_CHANGE: ["expense change", "expense increase", "expense decrease"],
      RENT_CHANGE: ["rent change", "rent increase", "rent decrease"],
      EMERGENCY_EXPENSE: ["emergency expense"],
      DEBT_CHANGE: ["debt change", "debt payment change"],
      GOAL_CHANGE: ["goal change", "goal adjustment"],
      MARKET_STRESS: ["market stress"],
    };
    const mentionedTypes = Object.entries(scenarioMentions)
      .filter(([, phrases]) => phrases.some((phrase) => new RegExp(`\\b${escapeRegex(phrase)}\\b`, "iu").test(item.text)))
      .map(([type]) => type);
    if (mentionedTypes.some((type) => type !== context.scenario.type)) {
      issues.push(issue("SCENARIO_MISMATCH", item.field, "The explanation names a different scenario type from the one calculated."));
    }
    if ((shortfall || feasibleFailure) && /\b(?:no\s+(?:goal\s+)?shortfall|shortfall\s+(?:is\s+)?(?:eliminated|zero)|goal\s+(?:is\s+)?(?:fully\s+funded|met|achieved)|fully\s+funded)\b/iu.test(item.text)) {
      issues.push(issue("SCENARIO_MISMATCH", item.field, "The explanation says the goal has no shortfall, but the deterministic scenario reports an unfunded goal."));
    }
    const negativeSurplus = Number(context.scenario.derived.monthlySurplus) < 0;
    if (negativeSurplus && /\b(?:surplus\s+(?:remains\s+)?positive|no\s+(?:monthly\s+)?deficit|cash\s+flow\s+is\s+positive)\b/iu.test(item.text)) {
      issues.push(issue("SCENARIO_MISMATCH", item.field, "The explanation describes positive cash flow while the deterministic scenario has negative monthly surplus."));
    }
  }
  return dedupeIssues(issues);
}

function checkUnsupportedClaims(texts: Array<{ field: string; text: string }>, context: AiAnalysisRequest, evidenceRefs: string[]): VerificationIssue[] {
  const issues: VerificationIssue[] = [];
  const citedExternal = context.retrievedContext.filter((item) => item.provenance === "EXTERNAL" && evidenceRefs.includes(item.chunkId));
  const positiveReturnAssumption = [context.baseline.raw, context.scenario.raw]
    .flatMap((profile) => profile.goals.map((goal) => goal.returnAssumption))
    .some((value) => value > 0);

  for (const item of texts) {
    const text = item.text;
    const citedText = citedExternal.map((entry) => entry.content.toLowerCase()).join(" ");
    const hasExternalTaxEvidence = /\btax(?:es|ation|able|-free)?\b/i.test(citedText);
    const hasExternalRegulatoryEvidence = /\b(?:sebi|regulat(?:or|ory|ion)|legal|law|compliance|licensed|registered adviser)\b/i.test(citedText);
    const hasExternalMarketEvidence = /\b(?:market|stock|equity|bond|index|mutual fund)\b/i.test(citedText);
    if (!hasExternalTaxEvidence && /\b(?:tax(?:es|ation|able| liability|-free)?|deductible)\b/iu.test(text)) {
      issues.push(issue("UNSUPPORTED_FACTUAL_CLAIM", item.field, "Tax claims have no supporting external evidence in the supplied context."));
    }
    if (!hasExternalRegulatoryEvidence && /\b(?:SEBI|regulat(?:or|ory|ion)|legal|law|compliance|compliant|licensed|registered investment adviser)\b/iu.test(text)) {
      issues.push(issue("UNSUPPORTED_FACTUAL_CLAIM", item.field, "Legal or regulatory claims have no supporting external evidence in the supplied context."));
    }
    if (!hasExternalMarketEvidence && /\b(?:market|stocks?|equities|bonds?|indices|index|mutual funds?)\s+(?:will|would|has|have|is expected to|returned|gained|lost|rose|fell|outperformed|underperformed)\b/iu.test(text)) {
      issues.push(issue("UNSUPPORTED_FACTUAL_CLAIM", item.field, "A market-performance claim has no supporting external evidence in the supplied context."));
    }
    if (!positiveReturnAssumption && /\b(?:(?:will|would|can|could|is expected to|should)\s+(?:earn|generate|deliver|produce|return)\s+(?:an?\s+)?(?:\d[\d,.]*\s*%\s+)?(?:return|yield|profit)?|(?:return|yield)\s+of\s+\d[\d,.]*\s*%)\b/iu.test(text)) {
      issues.push(issue("UNSUPPORTED_FACTUAL_CLAIM", item.field, "An investment return claim is unsupported by the supplied assumptions and evidence."));
    }
    if (/\b(?:credit score|net worth|tax liability|portfolio volatility|probability of success)\b/iu.test(text)) {
      issues.push(issue("UNSUPPORTED_FACTUAL_CLAIM", item.field, "The explanation claims a financial measure outside the supplied deterministic context."));
    }
  }
  return dedupeIssues(issues);
}

function checkGuaranteeLanguage(texts: Array<{ field: string; text: string }>): VerificationIssue[] {
  const issues: VerificationIssue[] = [];
  for (const item of texts) {
    const unqualifiedText = item.text.replace(/\b(?:not|never)\s+(?:be\s+)?(?:guaranteed?|certain|risk\s*[- ]\s*free)\b/giu, "");
    if (GUARANTEE_PATTERNS.some((pattern) => pattern.test(unqualifiedText))) {
      issues.push(issue("GUARANTEE_LANGUAGE_DETECTED", item.field, "The explanation contains overly certain or guaranteed financial language."));
    }
  }
  return dedupeIssues(issues);
}

function expectedMetricValues(metric: string, context: AiAnalysisRequest, sentence: string): unknown[] {
  const isDelta = /\b(?:delta|change|increase|decrease|difference)\b/iu.test(sentence);
  const isBaseline = /\b(?:baseline|before|prior)\b/iu.test(sentence);
  const deltaMetric = (context.delta as unknown as Record<string, { delta?: string | number | null; percentageDelta?: string | number | null }>)[metric];
  const selected = isDelta ? [deltaMetric?.delta, deltaMetric?.percentageDelta]
    : isBaseline ? [context.baseline.derived[metric as keyof typeof context.baseline.derived]]
      : [context.scenario.derived[metric as keyof typeof context.scenario.derived]];
  const values: unknown[] = selected.filter((value) => value !== null && value !== undefined);
  if (metric === "requiredMonthlyContribution" || metric === "projectedAmount" || metric === "projectedGoalShortfall") {
    const goals = isBaseline ? context.baseline.derived.goals : context.scenario.derived.goals;
    for (const goal of goals) {
      const value = goal[metric as "requiredMonthlyContribution" | "projectedAmount" | "projectedGoalShortfall"];
      if (value !== null) values.push(value);
    }
  }
  return values;
}

function collectAnalysisText(response: AiAnalysisResponse): Array<{ field: string; text: string }> {
  const result: Array<{ field: string; text: string }> = [];
  if (typeof response.summary === "string") result.push({ field: "summary", text: response.summary });
  for (const field of ["keyChanges", "tradeoffs", "assumptions", "limitations"] as const) {
    response[field].forEach((text, index) => result.push({ field: `${field}[${index}]`, text }));
  }
  return result;
}

interface NumericClaim { raw: string; key: string; value: number; kind: "plain" | "amount" | "percent"; period: "month" | "year" | null }

function numericTokens(text: string): NumericClaim[] {
  return [...text.matchAll(NUMBER_PATTERN)].map((match) => parseNumericClaim(match[0]!.trim())).filter((claim): claim is NumericClaim => claim !== null);
}

function parseNumericClaim(raw: string): NumericClaim | null {
  const valueMatch = /(-?\d[\d,]*(?:\.\d+)?)/u.exec(raw);
  if (!valueMatch) return null;
  const value = Number(valueMatch[1]!.replace(/,/g, ""));
  if (!Number.isFinite(value)) return null;
  const kind = /%/u.test(raw) ? "percent" : /(?:₹|lakhs?|crores?|thousand|million|billion)/iu.test(raw) ? "amount" : "plain";
  const scaleName = /\b(lakh|crore|thousand|million|billion)s?\b/iu.exec(raw)?.[1]?.toLowerCase();
  const scale = scaleName ? ({ lakh: 100_000, crore: 10_000_000, thousand: 1_000, million: 1_000_000, billion: 1_000_000_000 } as Record<string, number>)[scaleName] ?? 1 : 1;
  const periodMatch = /(?:\/\s*|\bper\s+)(month|year)\b|\b(monthly|annually|annual)\b/iu.exec(raw);
  const period = periodMatch?.[1]?.toLowerCase() ?? (periodMatch?.[2] ? (periodMatch[2].toLowerCase() === "monthly" ? "month" : "year") : null);
  const scaled = value * scale;
  return { raw, value: scaled, kind, period: period as "month" | "year" | null, key: `${scaled}:${kind}:${period ?? ""}` };
}

function numericValueMatches(claim: NumericClaim, value: unknown): boolean {
  if (typeof value !== "string" && typeof value !== "number") return false;
  const expected = parseNumericClaim(String(value));
  if (!expected || (claim.kind === "percent") !== (expected.kind === "percent")) return false;
  if (claim.period && claim.period !== expected.period) return false;
  return Math.abs(claim.value - expected.value) <= Math.max(1e-9, Math.abs(expected.value) * 1e-9);
}

function numericClaimMatches(claim: NumericClaim, expectedValue: unknown, metric: string): boolean {
  if (typeof expectedValue !== "string" && typeof expectedValue !== "number") return false;
  const expected = parseNumericClaim(String(expectedValue));
  if (!expected) return false;
  const percentageMetric = metric === "savingsRate" || metric === "debtToIncome";
  if (percentageMetric) {
    if (claim.kind === "amount" || expected.kind === "amount") return false;
    const expectedPercent = expected.kind === "percent" ? expected.value : expected.value * 100;
    const actualPercent = claim.kind === "percent" ? claim.value : claim.value * 100;
    if (Math.abs(expectedPercent - actualPercent) > Math.max(0.01, Math.abs(expectedPercent) * 0.0001)) return false;
  } else {
    if (claim.kind === "percent" || expected.kind === "percent") return false;
    if (Math.abs(claim.value - expected.value) > Math.max(1e-9, Math.abs(expected.value) * 1e-9)) return false;
  }
  const monthlyMetric = metric === "monthlySurplus" || metric === "availableMonthlyCashFlow" || metric === "requiredMonthlyContribution" || metric.startsWith("monthly");
  if (claim.period && monthlyMetric && claim.period !== "month") return false;
  if (claim.period && !monthlyMetric) return false;
  return true;
}

function positive(value: string | number | null): boolean {
  if (value === null) return false;
  const numeric = Number(value);
  return Number.isFinite(numeric) && numeric > 0;
}

function stableJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.entries(value).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0).map(([key, child]) => `${JSON.stringify(key)}:${stableJson(child)}`).join(",")}}`;
  }
  return JSON.stringify(value) ?? "undefined";
}

function cloneContext(context: AiAnalysisRequest): AiAnalysisRequest {
  return structuredClone(context);
}

function check(issues: VerificationIssue[]): VerificationCheck {
  return { status: issues.length ? "FLAGGED" : "PASS", issues };
}

function issue( code: VerificationIssue["code"], field: string | null, detail: string): VerificationIssue {
  return { code, field, detail };
}

function dedupeIssues(issues: VerificationIssue[]): VerificationIssue[] {
  const unique = new Map<string, VerificationIssue>();
  for (const item of issues) unique.set(`${item.code}\0${item.field ?? ""}\0${item.detail}`, item);
  return [...unique.values()];
}

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
