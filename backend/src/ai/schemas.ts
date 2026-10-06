import type { AiAnalysisRequest, AiAnalysisResponse } from "./types.js";
import { isProvenance, Provenance } from "../financial/constants.js";

const REQUEST_ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const RISK_TYPES = new Set([
  "LIQUIDITY_REDUCTION", "GOAL_SHORTFALL", "NEGATIVE_SURPLUS", "HIGHER_DEBT_BURDEN",
  "EMERGENCY_COVERAGE_REDUCTION", "MISSING_DATA",
]);

export class AiContractValidationError extends Error {
  constructor(message = "AI service contract data is invalid.") {
    super(message);
    this.name = "AiContractValidationError";
  }
}

export function validateAiAnalysisRequest(value: unknown): AiAnalysisRequest {
  const request = record(value);
  const baseKeys = [
    "requestId", "question", "financialTwin", "baseline", "scenario", "delta",
    "riskFlags", "assumptions", "evidence", "calculationVersion",
  ];
  if (Object.keys(request).some((key) => ![...baseKeys, "retrievedContext"].includes(key))) throw new AiContractValidationError("AI service contract fields are unsupported.");
  if (request.retrievedContext === undefined) request.retrievedContext = [];
  if (baseKeys.some((key) => !(key in request))) throw new AiContractValidationError("AI service contract fields are missing.");
  if (typeof request.requestId !== "string" || !REQUEST_ID_PATTERN.test(request.requestId)) {
    throw new AiContractValidationError("AI requestId must be a UUID.");
  }
  if (typeof request.question !== "string" || request.question.trim().length < 1 || request.question.length > 2000) {
    throw new AiContractValidationError("AI question must contain 1 to 2000 characters.");
  }
  if (request.calculationVersion !== "1.0") {
    throw new AiContractValidationError("Unsupported deterministic calculation version.");
  }
  const twin = record(request.financialTwin);
  exactKeys(twin, ["raw", "derived", "provenance"]);
  record(twin.raw);
  record(twin.derived);
  validateProvenanceState(twin.provenance, twin.raw, twin.derived);
  const baseline = record(request.baseline);
  exactKeys(baseline, ["raw", "derived", "provenance", "evidence"]);
  record(baseline.raw);
  record(baseline.derived);
  validateProvenanceState(baseline.provenance, baseline.raw, baseline.derived);
  validateEvidenceArray(baseline.evidence);
  const scenario = record(request.scenario);
  exactKeys(scenario, ["type", "status", "raw", "derived", "provenance", "evidence"]);
  record(scenario.raw);
  record(scenario.derived);
  validateProvenanceState(scenario.provenance, scenario.raw, scenario.derived);
  validateEvidenceArray(scenario.evidence);
  stringArray(request.assumptions);
  validateEvidenceArray(request.evidence);
  validateRiskFlags(request.riskFlags);
  record(request.delta);
  if (!Array.isArray(request.retrievedContext) || request.retrievedContext.length > 10) throw new AiContractValidationError("Retrieved context is invalid.");
  for (const itemValue of request.retrievedContext) {
    const item = record(itemValue);
    exactKeys(item, ["chunkId", "documentId", "title", "topic", "content", "sourceId", "sourceType", "sourceUrl", "provenance"]);
    for (const key of ["chunkId", "documentId", "title", "topic", "content", "sourceId", "sourceType"]) if (typeof item[key] !== "string") throw new AiContractValidationError("Retrieved context is invalid.");
    if (item.sourceUrl !== null && typeof item.sourceUrl !== "string") throw new AiContractValidationError("Retrieved source URL is invalid.");
    if (item.provenance !== "ASSUMPTION" && item.provenance !== "EXTERNAL") throw new AiContractValidationError("Retrieved source provenance is invalid.");
  }
  return request as unknown as AiAnalysisRequest;
}

export function parseAiAnalysisResponse(value: unknown, expectedRequestId: string, allowedEvidenceIds?: ReadonlySet<string>): AiAnalysisResponse {
  const response = record(value);
  exactKeys(response, [
    "requestId", "status", "summary", "keyChanges", "tradeoffs", "riskFlags",
    "evidenceRefs", "assumptions", "limitations", "model", "promptVersion", "calculationVersion",
  ]);
  if (response.requestId !== expectedRequestId || response.status !== "READY" || response.calculationVersion !== "1.0") {
    throw new AiContractValidationError("AI service response does not match the request contract.");
  }
  if (response.summary !== null && typeof response.summary !== "string") throw new AiContractValidationError();
  if (response.model !== null && typeof response.model !== "string") throw new AiContractValidationError();
  if (response.promptVersion !== null && typeof response.promptVersion !== "string") throw new AiContractValidationError();
  stringArray(response.keyChanges);
  stringArray(response.tradeoffs);
  stringArray(response.evidenceRefs);
  if (allowedEvidenceIds && (response.evidenceRefs as string[]).some((id) => !allowedEvidenceIds.has(id))) {
    throw new AiContractValidationError("AI service referenced evidence that Node did not supply.");
  }
  stringArray(response.assumptions);
  stringArray(response.limitations);
  validateRiskFlags(response.riskFlags);
  return response as unknown as AiAnalysisResponse;
}

function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new AiContractValidationError();
  return value as Record<string, unknown>;
}

function exactKeys(value: Record<string, unknown>, keys: string[]): void {
  if (Object.keys(value).length !== keys.length || keys.some((key) => !(key in value))) {
    throw new AiContractValidationError("AI service contract fields are missing or unsupported.");
  }
}

function stringArray(value: unknown): void {
  if (!Array.isArray(value) || value.some((item) => typeof item !== "string")) throw new AiContractValidationError();
}

function validateProvenanceState(value: unknown, rawValue: unknown, derivedValue: unknown): void {
  const provenance = record(value);
  const rawData = record(rawValue);
  const derivedData = record(derivedValue);
  exactKeys(provenance, ["raw", "derived", "goalFields", "assumptions"]);
  const rawProvenance = record(provenance.raw);
  for (const [key, value] of Object.entries(rawProvenance)) {
    if (!(key in rawData) || !isProvenance(value)) {
      throw new AiContractValidationError("AI request contains invalid raw provenance.");
    }
    if (value === Provenance.AI_INTERPRETATION) {
      throw new AiContractValidationError("AI interpretation provenance cannot be trusted as raw financial data.");
    }
  }
  const derivedProvenance = record(provenance.derived);
  const derivedKeys = Object.keys(derivedData);
  if (Object.keys(derivedProvenance).length !== derivedKeys.length ||
      derivedKeys.some((key) => derivedProvenance[key] !== Provenance.COMPUTED)) {
    throw new AiContractValidationError("Every derived financial value must be labeled COMPUTED.");
  }
  if (provenance.assumptions !== Provenance.ASSUMPTION) {
    throw new AiContractValidationError("AI request assumptions must be labeled ASSUMPTION.");
  }
  if (!Array.isArray(provenance.goalFields)) {
    throw new AiContractValidationError("AI request goal field provenance must be an array.");
  }
  if (!Array.isArray(rawData.goals) || provenance.goalFields.length !== rawData.goals.length) {
    throw new AiContractValidationError("AI request goal field provenance does not match the supplied goals.");
  }
  for (const [index, goalFields] of provenance.goalFields.entries()) {
    const fields = record(goalFields);
    const goalData = record(rawData.goals[index]);
    if (Object.entries(fields).some(([key, item]) =>
      !(key in goalData) || !isProvenance(item) || item === Provenance.AI_INTERPRETATION,
    )) {
      throw new AiContractValidationError("AI interpretation cannot be trusted as goal input provenance.");
    }
  }
}

function validateEvidenceArray(value: unknown): void {
  if (!Array.isArray(value)) throw new AiContractValidationError();
  for (const item of value) {
    const evidence = record(item);
    const calculation = evidence.type === "CALCULATION";
    const baseKeys = ["metric", "expression", "baselineValue", "scenarioValue", "result", "provenance", "evidenceId"];
    exactKeys(evidence, calculation ? [...baseKeys, "type", "id", "calculationId", "inputs", "formula", "output", "timestamp"] : baseKeys);
    if (typeof evidence.metric !== "string" || typeof evidence.expression !== "string" ||
        typeof evidence.result !== "boolean" || evidence.provenance !== Provenance.COMPUTED ||
        typeof evidence.evidenceId !== "string") throw new AiContractValidationError();
    if (calculation && (evidence.id !== evidence.evidenceId || evidence.calculationId !== evidence.evidenceId ||
        typeof evidence.formula !== "string" || typeof evidence.timestamp !== "string" ||
        !/^\d{4}-\d\d-\d\dT/.test(evidence.timestamp) || !evidence.inputs || typeof evidence.inputs !== "object" ||
        !/^CALC-[A-F0-9]{12}$/.test(String(evidence.evidenceId)))) throw new AiContractValidationError();
    for (const key of ["baselineValue", "scenarioValue"]) {
      const entry = evidence[key];
      if (entry !== null && typeof entry !== "string" && typeof entry !== "number" && typeof entry !== "boolean") {
        throw new AiContractValidationError();
      }
    }
  }
}

function validateRiskFlags(value: unknown): void {
  if (!Array.isArray(value)) throw new AiContractValidationError();
  for (const item of value) {
    const flag = record(item);
    exactKeys(flag, ["type", "severity", "trigger", "evidence", "details"]);
    if (typeof flag.type !== "string" || !RISK_TYPES.has(flag.type) ||
        !["low", "medium", "high"].includes(String(flag.severity)) || typeof flag.trigger !== "string") {
      throw new AiContractValidationError();
    }
    stringArray(flag.evidence);
    record(flag.details);
  }
}
