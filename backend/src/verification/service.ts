import { parseAiAnalysisResponse, validateAiAnalysisRequest } from "../ai/schemas.js";
import type { AiAnalysisRequest, AiAnalysisResponse } from "../ai/types.js";
import type { RiskFlag } from "../financial/types.js";
import type { AiVerificationResult, VerificationCheck, VerificationIssue } from "./types.js";

const NUMBER_PATTERN = /(?<![\p{L}\p{N}_])(?:₹\s*)?-?\d[\d,]*(?:\.\d+)?(?:\s*(?:%|lakhs?|crores?|thousand|million|billion))?/giu;
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
  const numeric = check(checkNumericClaims(strings, context));
  const evidenceReferences = check(checkEvidenceReferences(parsed.evidenceRefs, context));
  const scenarioConsistency = check(checkScenarioConsistency(parsed, context, strings));
  const unsupportedClaims = check(checkUnsupportedClaims(strings, context));
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

function checkNumericClaims(texts: Array<{ field: string; text: string }>, context: AiAnalysisRequest): VerificationIssue[] {
  const supported = new Set<string>();
  collectNumbers(context.financialTwin.raw, supported);
  collectNumbers(context.financialTwin.derived, supported);
  collectNumbers(context.baseline.raw, supported);
  collectNumbers(context.baseline.derived, supported);
  collectNumbers(context.scenario.raw, supported);
  collectNumbers(context.scenario.derived, supported);
  collectNumbers(context.delta, supported);
  collectNumbers(context.riskFlags.map((flag) => flag.details), supported);
  for (const item of context.evidence) collectEvidenceNumbers(item, supported);
  for (const item of context.baseline.evidence) collectEvidenceNumbers(item, supported);
  for (const item of context.scenario.evidence) collectEvidenceNumbers(item, supported);
  for (const assumption of context.assumptions) collectNumericTokens(assumption, supported);
  for (const item of context.retrievedContext) collectNumericTokens(item.content, supported);

  const issues: VerificationIssue[] = [];
  for (const item of texts) {
    for (const token of numericTokens(item.text)) {
      if (!supported.has(token.key)) {
        issues.push(issue("UNSUPPORTED_NUMERIC_CLAIM", item.field, `The numeric claim “${token.raw}” is not present in supplied authoritative context or evidence.`));
      }
    }
    issues.push(...checkExplicitMetricValues(item, context));
    issues.push(...checkExplicitScenarioActionValues(item, context));
  }
  return dedupeIssues(issues);
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

function checkUnsupportedClaims(texts: Array<{ field: string; text: string }>, context: AiAnalysisRequest): VerificationIssue[] {
  const issues: VerificationIssue[] = [];
  const externalText = context.retrievedContext.filter((item) => item.provenance === "EXTERNAL").map((item) => item.content).join(" ").toLowerCase();
  const hasExternalTaxEvidence = /\btax(?:es|ation|able|-free)?\b/i.test(externalText);
  const hasExternalRegulatoryEvidence = /\b(?:sebi|regulat(?:or|ory|ion)|legal|law|compliance|licensed|registered adviser)\b/i.test(externalText);
  const hasExternalMarketEvidence = /\b(?:market|stock|equity|bond|index|mutual fund)\b/i.test(externalText);
  const positiveReturnAssumption = [context.baseline.raw, context.scenario.raw]
    .flatMap((profile) => profile.goals.map((goal) => goal.returnAssumption))
    .some((value) => value > 0);

  for (const item of texts) {
    const text = item.text;
    if (!hasExternalTaxEvidence && /\b(?:tax(?:es|ation|able| liability|-free)?|deductible)\b/iu.test(text)) {
      issues.push(issue("UNSUPPORTED_FACTUAL_CLAIM", item.field, "Tax claims have no supporting external evidence in the supplied context."));
    }
    if (!hasExternalRegulatoryEvidence && /\b(?:SEBI|regulat(?:or|ory|ion)|legal|law|compliance|compliant|licensed|registered investment adviser)\b/iu.test(text)) {
      issues.push(issue("UNSUPPORTED_FACTUAL_CLAIM", item.field, "Legal or regulatory claims have no supporting external evidence in the supplied context."));
    }
    if (!hasExternalMarketEvidence && /\b(?:market|stocks?|equities|bonds?|indices|index|mutual funds?)\s+(?:will|would|has|have|is expected to|returned|gained|lost|rose|fell|outperformed|underperformed)\b/iu.test(text)) {
      issues.push(issue("UNSUPPORTED_FACTUAL_CLAIM", item.field, "A market-performance claim has no supporting external evidence in the supplied context."));
    }
    if (!positiveReturnAssumption && /\b(?:(?:will|would|can|could|is expected to|should)\s+(?:earn|generate|deliver|produce)\s+(?:an?\s+)?(?:\d[\d,.]*\s*%\s+)?(?:return|yield|profit)|(?:return|yield)\s+of\s+\d[\d,.]*\s*%)\b/iu.test(text)) {
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

function checkExplicitMetricValues(item: { field: string; text: string }, context: AiAnalysisRequest): VerificationIssue[] {
  const issues: VerificationIssue[] = [];
  const sentences = item.text.split(/(?<=[.!?;])\s+/u);
  for (const sentence of sentences) {
    const numbers = numericTokens(sentence);
    if (!numbers.length) continue;
    for (const spec of METRIC_SPECS) {
      if (!spec.aliases.some((alias) => new RegExp(`\\b${escapeRegex(alias)}\\b`, "iu").test(sentence))) continue;
      if (numbers.length !== 1) continue;
      const expected = expectedMetricValues(spec.metric, context, sentence);
      if (expected.length && !expected.some((value) => value === numbers[0]!.key)) {
        issues.push(issue("NUMERIC_MISMATCH", item.field, `The stated ${spec.name} does not match the corresponding deterministic scenario value.`));
      }
    }
  }
  return issues;
}

function expectedMetricValues(metric: string, context: AiAnalysisRequest, sentence: string): string[] {
  const isDelta = /\b(?:delta|change|increase|decrease|difference)\b/iu.test(sentence);
  const isBaseline = /\b(?:baseline|before|prior)\b/iu.test(sentence);
  const deltaMetric = (context.delta as unknown as Record<string, { delta?: string | number | null; percentageDelta?: string | number | null }>)[metric];
  const selected = isDelta ? [deltaMetric?.delta, deltaMetric?.percentageDelta]
    : isBaseline ? [context.baseline.derived[metric as keyof typeof context.baseline.derived]]
      : [context.scenario.derived[metric as keyof typeof context.scenario.derived], deltaMetric?.delta];
  const values: string[] = [];
  for (const value of selected) appendValueNumbers(value, values);
  if (metric === "requiredMonthlyContribution" || metric === "projectedAmount" || metric === "projectedGoalShortfall") {
    const goals = isBaseline ? context.baseline.derived.goals : context.scenario.derived.goals;
    for (const goal of goals) appendValueNumbers(goal[metric as "requiredMonthlyContribution" | "projectedAmount" | "projectedGoalShortfall"], values);
  }
  return values;
}

function checkExplicitScenarioActionValues(item: { field: string; text: string }, context: AiAnalysisRequest): VerificationIssue[] {
  const issues: VerificationIssue[] = [];
  const sentences = item.text.split(/(?<=[.!?;])\s+/u);
  for (const sentence of sentences) {
    const numbers = numericTokens(sentence);
    if (numbers.length !== 1) continue;
    for (const spec of ACTION_VALUE_FIELDS) {
      const baseline = context.baseline.raw[spec.field as keyof typeof context.baseline.raw];
      const scenario = context.scenario.raw[spec.field as keyof typeof context.scenario.raw];
      if (typeof baseline !== "string" || typeof scenario !== "string" || normalizeNumber(baseline) === normalizeNumber(scenario)) continue;
      const alias = spec.aliases.find((candidate) => new RegExp(`\\b${escapeRegex(candidate)}\\b`, "iu").test(sentence));
      if (!alias) continue;
      const pattern = new RegExp(`\\b${escapeRegex(alias)}\\b[^.!?;]{0,60}?\\b(?:is|of|to|at|equals?|becomes?|reaches?|increases?\\s+to|decreases?\\s+to|changes?\\s+to)\\s*(?:₹\\s*)?(-?\\d[\\d,]*(?:\\.\\d+)?(?:\\s*(?:%|lakhs?|crores?|thousand|million|billion))?)`, "iu");
      const match = pattern.exec(sentence);
      if (!match) continue;
      const expected = /\b(?:baseline|before|prior)\b/iu.test(sentence) ? normalizeNumber(baseline) : normalizeNumber(scenario);
      if (numbers[0]!.key !== expected) {
        issues.push(issue("SCENARIO_MISMATCH", item.field, `The stated ${spec.field} conflicts with the calculated scenario state.`));
      }
    }
  }
  return issues;
}

function collectAnalysisText(response: AiAnalysisResponse): Array<{ field: string; text: string }> {
  const result: Array<{ field: string; text: string }> = [];
  if (typeof response.summary === "string") result.push({ field: "summary", text: response.summary });
  for (const field of ["keyChanges", "tradeoffs", "assumptions", "limitations"] as const) {
    response[field].forEach((text, index) => result.push({ field: `${field}[${index}]`, text }));
  }
  return result;
}

function collectNumbers(value: unknown, result: Set<string>, parentKey = ""): void {
  if (typeof value === "number" && Number.isFinite(value)) { collectNumericTokens(String(value), result); return; }
  if (typeof value === "string") { collectNumericTokens(value, result); return; }
  if (Array.isArray(value)) { value.forEach((item) => collectNumbers(item, result, parentKey)); return; }
  if (!value || typeof value !== "object") return;
  const ignored = /^(?:name|currency|status|type|provenance|evidenceId|id|calculationId|timestamp|targetDate|sourceId|chunkId|documentId|sourceUrl|formula|expression|trigger)$/iu;
  for (const [key, child] of Object.entries(value)) if (!ignored.test(key)) collectNumbers(child, result, key);
}

function collectEvidenceNumbers(value: AiAnalysisRequest["evidence"][number], result: Set<string>): void {
  collectNumbers(value.baselineValue, result);
  collectNumbers(value.scenarioValue, result);
  collectNumbers(value.result, result);
  if (value.inputs) collectNumbers(value.inputs, result);
  if (value.output !== undefined) collectNumbers(value.output, result);
}

function collectNumericTokens(text: string, result: Set<string>): void {
  for (const item of numericTokens(text)) result.add(item.key);
}

function numericTokens(text: string): Array<{ raw: string; key: string }> {
  return [...text.matchAll(NUMBER_PATTERN)].map((match) => ({ raw: match[0]!.trim(), key: normalizeNumber(match[0]!) }));
}

function normalizeNumber(value: string): string {
  const match = /(-?\d[\d,]*(?:\.\d+)?)(?:\s*(%|lakhs?|crores?|thousand|million|billion))?/iu.exec(value);
  if (!match) return value.trim().toLowerCase();
  let [integer, fraction = ""] = match[1]!.replace(/,/g, "").split(".");
  integer = integer!.replace(/^(-?)0+(?=\d)/u, "$1");
  fraction = fraction.replace(/0+$/u, "");
  const numeric = `${integer}${fraction ? `.${fraction}` : ""}`;
  const unit = (match[2] ?? "").toLowerCase().replace(/s$/u, "");
  return `${numeric}:${unit}`;
}

function appendValueNumbers(value: unknown, result: string[]): void {
  if (typeof value === "number" && Number.isFinite(value)) result.push(normalizeNumber(String(value)));
  else if (typeof value === "string") result.push(...numericTokens(value).map((item) => item.key));
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
