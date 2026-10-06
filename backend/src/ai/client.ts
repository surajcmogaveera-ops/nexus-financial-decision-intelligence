import type { AiAnalysisRequest, AiAnalysisResponse } from "./types.js";
import { AiContractValidationError, parseAiAnalysisResponse, validateAiAnalysisRequest } from "./schemas.js";

export type AiServiceErrorCode =
  | "INVALID_AI_REQUEST"
  | "AI_SERVICE_NOT_CONFIGURED"
  | "AI_SERVICE_TIMEOUT"
  | "AI_SERVICE_UNAVAILABLE"
  | "AI_SERVICE_UNAUTHORIZED"
  | "AI_SERVICE_REJECTED_REQUEST"
  | "AI_SERVICE_FAILURE"
  | "AI_SERVICE_INVALID_RESPONSE";

const ERROR_STATUS: Record<AiServiceErrorCode, number> = {
  INVALID_AI_REQUEST: 400,
  AI_SERVICE_NOT_CONFIGURED: 503,
  AI_SERVICE_TIMEOUT: 504,
  AI_SERVICE_UNAVAILABLE: 503,
  AI_SERVICE_UNAUTHORIZED: 502,
  AI_SERVICE_REJECTED_REQUEST: 502,
  AI_SERVICE_FAILURE: 502,
  AI_SERVICE_INVALID_RESPONSE: 502,
};

export class AiServiceError extends Error {
  readonly status: number;

  constructor(readonly code: AiServiceErrorCode, message: string) {
    super(message);
    this.name = "AiServiceError";
    this.status = ERROR_STATUS[code];
  }
}

export interface AiServiceClientOptions {
  serviceUrl?: string;
  serviceToken?: string;
  fetcher?: typeof fetch;
  timeoutMs?: number;
}

export class AiServiceClient {
  private readonly serviceUrl: string | undefined;
  private readonly serviceToken: string | undefined;
  private readonly fetcher: typeof fetch;
  private readonly timeoutMs: number;

  constructor(options: AiServiceClientOptions = {}) {
    this.serviceUrl = options.serviceUrl ?? process.env.AI_SERVICE_URL;
    this.serviceToken = options.serviceToken ?? process.env.AI_SERVICE_TOKEN;
    this.fetcher = options.fetcher ?? fetch;
    this.timeoutMs = options.timeoutMs ?? 5_000;
  }

  async analyze(input: unknown): Promise<AiAnalysisResponse> {
    let request: AiAnalysisRequest;
    try {
      request = validateAiAnalysisRequest(input);
    } catch {
      throw new AiServiceError("INVALID_AI_REQUEST", "The internal AI request is invalid.");
    }

    const endpoint = this.resolveEndpoint();
    if (!this.serviceToken?.trim()) {
      throw new AiServiceError("AI_SERVICE_NOT_CONFIGURED", "The internal AI service is not configured.");
    }

    let upstream: Response;
    try {
      upstream = await this.fetcher(endpoint, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "X-Service-Token": this.serviceToken,
        },
        body: JSON.stringify(request),
        signal: AbortSignal.timeout(this.timeoutMs),
      });
    } catch (error) {
      if (isTimeout(error)) {
        throw new AiServiceError("AI_SERVICE_TIMEOUT", "The internal AI service timed out.");
      }
      throw new AiServiceError("AI_SERVICE_UNAVAILABLE", "The internal AI service is unavailable.");
    }

    if (upstream.status === 401 || upstream.status === 403) {
      throw new AiServiceError("AI_SERVICE_UNAUTHORIZED", "The internal AI service rejected authentication.");
    }
    if (upstream.status === 422) {
      throw new AiServiceError("AI_SERVICE_REJECTED_REQUEST", "The internal AI service rejected the request contract.");
    }
    if (!upstream.ok) {
      throw new AiServiceError("AI_SERVICE_FAILURE", "The internal AI service failed to process the request.");
    }

    let body: unknown;
    try {
      body = await upstream.json();
      const evidenceIds = new Set([
        ...request.evidence.map((item) => item.evidenceId),
        ...request.baseline.evidence.map((item) => item.evidenceId),
        ...request.scenario.evidence.map((item) => item.evidenceId),
        ...request.retrievedContext.map((item) => item.chunkId),
      ]);
      return parseAiAnalysisResponse(body, request.requestId, evidenceIds);
    } catch (error) {
      if (error instanceof AiContractValidationError) {
        throw new AiServiceError("AI_SERVICE_INVALID_RESPONSE", "The internal AI service returned an invalid response.");
      }
      throw new AiServiceError("AI_SERVICE_INVALID_RESPONSE", "The internal AI service returned an invalid response.");
    }
  }

  private resolveEndpoint(): string {
    if (!this.serviceUrl) {
      throw new AiServiceError("AI_SERVICE_NOT_CONFIGURED", "The internal AI service is not configured.");
    }
    try {
      const base = new URL(this.serviceUrl);
      if (!["http:", "https:"].includes(base.protocol) || base.username || base.password || base.search || base.hash) {
        throw new Error("Invalid service URL");
      }
      return new URL("internal/ai/analyze", `${base.toString().replace(/\/+$/, "")}/`).toString();
    } catch {
      throw new AiServiceError("AI_SERVICE_NOT_CONFIGURED", "The internal AI service is not configured.");
    }
  }
}

function isTimeout(error: unknown): boolean {
  const name = (error as { name?: unknown } | null)?.name;
  return name === "TimeoutError" || name === "AbortError";
}
