import { InputValidationError, parseFinancialTwinRequest, type ParsedFinancialTwinRequest } from "../financial/schemas.js";
import { SCENARIO_TYPES, type ScenarioType } from "../scenarios/types.js";
import { parseScenarioInput } from "../scenarios/schemas.js";
import type { BaselineRequestField, ValidatedSimulationRequest } from "./types.js";

export type SimulationErrorCode = "INVALID_REQUEST" | "INVALID_SCENARIO" | "UNSUPPORTED_SCENARIO" | "CALCULATION_ERROR";

const HTTP_STATUS: Record<SimulationErrorCode, number> = {
  INVALID_REQUEST: 400,
  INVALID_SCENARIO: 400,
  UNSUPPORTED_SCENARIO: 422,
  CALCULATION_ERROR: 500,
};

export class SimulationServiceError extends Error {
  readonly status: number;

  constructor(
    readonly code: SimulationErrorCode,
    message: string,
    readonly details: Record<string, string> = {},
  ) {
    super(message);
    this.name = "SimulationServiceError";
    this.status = HTTP_STATUS[code];
  }
}

type JsonObject = Record<string, unknown>;
function isObject(value: unknown): value is JsonObject {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function parseBaseline(value: unknown, asOfDate: unknown): ParsedFinancialTwinRequest {
  if (typeof asOfDate !== "string") {
    throw new SimulationServiceError("INVALID_REQUEST", "asOfDate is required for reproducible simulation calculations.", {
      asOfDate: "Provide a valid YYYY-MM-DD date",
    });
  }
  try {
    return parseFinancialTwinRequest({ profile: value, asOfDate });
  } catch (error) {
    if (error instanceof InputValidationError) {
      throw new SimulationServiceError("INVALID_REQUEST", error.message, error.details);
    }
    throw error;
  }
}

export function validateSimulationRequest(
  value: unknown,
  baselineField: BaselineRequestField = "baseline",
): ValidatedSimulationRequest {
  if (!isObject(value)) {
    throw new SimulationServiceError("INVALID_REQUEST", "Request body must be a JSON object.", { request: "Expected an object" });
  }
  const allowed = [baselineField, "asOfDate", "scenario"];
  const unsupported = Object.keys(value).filter((key) => !allowed.includes(key));
  if (unsupported.length) {
    throw new SimulationServiceError("INVALID_REQUEST", "Request contains unsupported fields.", {
      request: `Unsupported field(s): ${unsupported.join(", ")}`,
    });
  }
  if (!(baselineField in value)) {
    throw new SimulationServiceError("INVALID_REQUEST", `${baselineField} is required.`, { [baselineField]: "Required" });
  }

  const baseline = parseBaseline(value[baselineField], value.asOfDate);
  if (!isObject(value.scenario)) {
    throw new SimulationServiceError("INVALID_SCENARIO", "scenario must be a structured object.", { scenario: "Expected an object" });
  }
  if (typeof value.scenario.type === "string" && !SCENARIO_TYPES.includes(value.scenario.type as ScenarioType)) {
    throw new SimulationServiceError("UNSUPPORTED_SCENARIO", "The requested scenario type is not supported.", {
      "scenario.type": `Expected one of: ${SCENARIO_TYPES.join(", ")}`,
    });
  }
  try {
    return { baseline, scenario: parseScenarioInput(value.scenario) };
  } catch (error) {
    if (error instanceof InputValidationError) {
      throw new SimulationServiceError("INVALID_SCENARIO", error.message, error.details);
    }
    throw error;
  }
}
