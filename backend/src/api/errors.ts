export type ApiErrorCode = "FINANCIAL_PROFILE_NOT_FOUND" | "FINANCIAL_PROFILE_INCOMPLETE" | "GOAL_NOT_FOUND" | "INVALID_GOAL";

const STATUS: Record<ApiErrorCode, number> = {
  FINANCIAL_PROFILE_NOT_FOUND: 404,
  FINANCIAL_PROFILE_INCOMPLETE: 422,
  GOAL_NOT_FOUND: 404,
  INVALID_GOAL: 400,
};

export class ApiResourceError extends Error {
  readonly status: number;

  constructor(
    readonly code: ApiErrorCode,
    message: string,
    readonly details: Record<string, string> = {},
  ) {
    super(message);
    this.name = "ApiResourceError";
    this.status = STATUS[code];
  }
}
