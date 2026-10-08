export type VerificationStatus = "PASS" | "PASS_WITH_LIMITATION" | "FLAGGED";
export type VerificationCheckStatus = "PASS" | "FLAGGED" | "NOT_RUN";

export type VerificationIssueCode =
  | "SCHEMA_INVALID"
  | "NUMERIC_MISMATCH"
  | "UNSUPPORTED_NUMERIC_CLAIM"
  | "UNKNOWN_EVIDENCE_REFERENCE"
  | "SCENARIO_MISMATCH"
  | "UNSUPPORTED_FACTUAL_CLAIM"
  | "GUARANTEE_LANGUAGE_DETECTED"
  | "VERIFIER_FAILURE";

export interface VerificationIssue {
  code: VerificationIssueCode;
  field: string | null;
  detail: string;
}

export interface VerificationCheck {
  status: VerificationCheckStatus;
  issues: VerificationIssue[];
}

export interface AiVerificationResult {
  status: VerificationStatus;
  checks: {
    schema: VerificationCheck;
    numeric: VerificationCheck;
    evidenceReferences: VerificationCheck;
    scenarioConsistency: VerificationCheck;
    unsupportedClaims: VerificationCheck;
    guaranteeLanguage: VerificationCheck;
  };
  issues: VerificationIssue[];
  limitations: string[];
}
