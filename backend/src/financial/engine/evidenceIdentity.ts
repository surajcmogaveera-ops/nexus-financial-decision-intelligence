import { createHash } from "node:crypto";

const EVIDENCE_DECIMAL_PRECISION = 16;
const MAX_ABSOLUTE_EXPONENT = 10_000;
const UNDEFINED_MARKER = { $type: "undefined" } as const;

type CanonicalJson = null | boolean | string | CanonicalJson[] | { [key: string]: CanonicalJson };

/**
 * Evidence-only numeric mapping: decimal values are rounded to 16 significant
 * digits (nearest, ties to even), trailing zeros are removed, and zero has no
 * sign. This aligns Python Decimal reference values with finite JS Number
 * display precision without changing any financial calculation.
 */
export function canonicalEvidenceNumber(value: number | string): string {
  if (typeof value === "number" && !Number.isFinite(value)) {
    throw new TypeError("evidence numbers must be finite");
  }
  const text = typeof value === "number" ? value.toString() : value;
  const match = /^([+-]?)(\d+)(?:\.(\d*))?(?:[eE]([+-]?\d+))?$/.exec(text);
  if (!match) throw new TypeError("evidence numeric strings must be finite decimal values");

  const sign = match[1] === "-" ? "-" : "";
  const whole = match[2];
  const fraction = match[3] ?? "";
  const exponent = Number(match[4] ?? 0);
  if (!Number.isSafeInteger(exponent) || Math.abs(exponent) > MAX_ABSOLUTE_EXPONENT) {
    throw new RangeError("evidence number exponent exceeds the supported range");
  }

  const rawDigits = `${whole}${fraction}`;
  const firstNonZero = rawDigits.search(/[1-9]/);
  if (firstNonZero === -1) return "0";
  let digits = rawDigits.slice(firstNonZero).replace(/0+$/, "");
  let decimalPosition = whole.length + exponent - firstNonZero;

  if (digits.length > EVIDENCE_DECIMAL_PRECISION) {
    const kept = digits.slice(0, EVIDENCE_DECIMAL_PRECISION);
    const discarded = digits.slice(EVIDENCE_DECIMAL_PRECISION);
    const firstDiscarded = Number(discarded[0]);
    const hasLaterNonZero = /[1-9]/.test(discarded.slice(1));
    const lastKeptIsOdd = Number(kept.at(-1)) % 2 === 1;
    const roundUp = firstDiscarded > 5 ||
      (firstDiscarded === 5 && (hasLaterNonZero || lastKeptIsOdd));
    const rounded = BigInt(kept) + (roundUp ? 1n : 0n);
    digits = rounded.toString();
    if (digits.length > EVIDENCE_DECIMAL_PRECISION) {
      digits = `1${"0".repeat(EVIDENCE_DECIMAL_PRECISION - 1)}`;
      decimalPosition += 1;
    }
    digits = digits.replace(/0+$/, "");
  }

  if (Math.abs(decimalPosition) > MAX_ABSOLUTE_EXPONENT) {
    throw new RangeError("evidence number exponent exceeds the supported range");
  }
  let normalized: string;
  if (decimalPosition <= 0) {
    normalized = `0.${"0".repeat(-decimalPosition)}${digits}`;
  } else if (decimalPosition >= digits.length) {
    normalized = `${digits}${"0".repeat(decimalPosition - digits.length)}`;
  } else {
    normalized = `${digits.slice(0, decimalPosition)}.${digits.slice(decimalPosition)}`;
  }
  return `${sign}${normalized}`;
}

/** Recursively sort object keys and make absent values explicit before JSON serialization. */
export function canonicalizeEvidenceValue(value: unknown): CanonicalJson {
  if (value === undefined) return UNDEFINED_MARKER;
  if (value === null || typeof value === "boolean") return value;
  if (typeof value === "number") {
    return canonicalEvidenceNumber(value);
  }
  if (typeof value === "string") {
    if (["NaN", "Infinity", "+Infinity", "-Infinity"].includes(value)) {
      throw new TypeError("evidence numbers must be finite");
    }
    return /^[+-]?\d+(?:\.\d*)?(?:[eE][+-]?\d+)?$/.test(value)
      ? canonicalEvidenceNumber(value)
      : value;
  }
  if (Array.isArray(value)) return value.map(canonicalizeEvidenceValue);
  if (typeof value === "object") {
    return Object.fromEntries(
      Object.keys(value).sort().map((key) => [
        key,
        canonicalizeEvidenceValue((value as Record<string, unknown>)[key]),
      ]),
    );
  }
  throw new TypeError("unsupported value in deterministic evidence");
}

export interface CalculationEvidenceIdentityInput {
  metric: string;
  expression: string;
  baseline: unknown;
  scenario: unknown;
  result: boolean;
  provenance: "COMPUTED";
}

/** Mirrors the Python reference's sorted, compact JSON identity payload. */
export function calculationEvidenceId(input: CalculationEvidenceIdentityInput): string {
  const numericField = (value: unknown): CanonicalJson => {
    if (value === undefined) return UNDEFINED_MARKER;
    if (value === null || typeof value === "boolean") return value;
    if (typeof value !== "number" && typeof value !== "string") {
      throw new TypeError("calculation evidence values must be numeric, boolean, null, or undefined");
    }
    return canonicalEvidenceNumber(value);
  };
  const normalized = {
    metric: input.metric,
    expression: input.expression,
    baseline: numericField(input.baseline),
    scenario: numericField(input.scenario),
    result: input.result,
    provenance: input.provenance,
  };
  const encoded = JSON.stringify(canonicalizeEvidenceValue(normalized));
  const digest = createHash("sha256").update(encoded).digest("hex").slice(0, 12).toUpperCase();
  return `CALC-${digest}`;
}
