export interface ApiErrorBody {
  code?: string;
  message?: string;
  details?: Record<string, unknown>;
}

export class ApiClientError extends Error {
  readonly status: number;
  readonly code: string;
  readonly details: Record<string, unknown>;

  constructor(
    message: string,
    status: number,
    code: string,
    details: Record<string, unknown> = {},
  ) {
    super(message);
    this.name = "ApiClientError";
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

const configuredBaseUrl = process.env.NEXT_PUBLIC_API_BASE_URL?.trim();
const apiBaseUrl = (configuredBaseUrl || "http://127.0.0.1:3000").replace(/\/+$/, "");

async function requestJson<T>(path: string, init: RequestInit = {}): Promise<T> {
  if (!path.startsWith("/") || path.startsWith("//")) {
    throw new ApiClientError("The API path must be a local application route.", 0, "INVALID_API_PATH");
  }

  let response: Response;
  try {
    response = await fetch(`${apiBaseUrl}${path}`, {
      ...init,
      credentials: "include",
      cache: "no-store",
      headers: {
        Accept: "application/json",
        ...(init.body ? { "Content-Type": "application/json" } : {}),
        ...init.headers,
      },
    });
  } catch {
    throw new ApiClientError("The NEXUS backend could not be reached. Check that it is running and try again.", 0, "API_UNAVAILABLE");
  }

  const payload: unknown = await response.json().catch(() => null);
  if (!response.ok) {
    const error = isApiErrorBody(payload) ? payload.error : undefined;
    throw new ApiClientError(
      error?.message || `The backend request failed (${response.status}).`,
      response.status,
      error?.code || "API_ERROR",
      error?.details || {},
    );
  }

  if (payload === null) {
    throw new ApiClientError("The backend returned an invalid response.", response.status, "INVALID_API_RESPONSE");
  }
  return payload as T;
}

function isApiErrorBody(value: unknown): value is { error?: ApiErrorBody } {
  return typeof value === "object" && value !== null && "error" in value;
}

export interface SafeUser {
  id: string;
  email: string;
  name: string | null;
}

export interface FinancialTwinSummary {
  raw: Record<string, unknown>;
  derived: Record<string, unknown>;
  provenance: Record<string, unknown>;
  riskFlags: unknown[];
  assumptions: unknown[];
  calculatedAt?: string;
}

export const api = {
  register(input: { name: string; email: string; password: string }) {
    return requestJson<{ user: SafeUser }>("/api/auth/register", { method: "POST", body: JSON.stringify(input) });
  },
  login(input: { email: string; password: string }) {
    return requestJson<{ user: SafeUser }>("/api/auth/login", { method: "POST", body: JSON.stringify(input) });
  },
  logout() {
    return requestJson<{ status: "ok" }>("/api/auth/logout", { method: "POST" });
  },
  currentUser() {
    return requestJson<{ user: SafeUser }>("/api/auth/me");
  },
  financialTwin() {
    return requestJson<FinancialTwinSummary>("/api/financial-twin");
  },
};
