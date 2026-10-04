import type { Money, MoneyInput } from "./types.js";

const MAX_MAJOR_DIGITS = 16;
const DECIMAL_PRECISION = 28;

function decimalText(value: MoneyInput, field: string): string {
  if (typeof value === "number") {
    if (!Number.isFinite(value) || Math.abs(value) > Number.MAX_SAFE_INTEGER) {
      throw new TypeError(`${field} must be a finite, safely representable amount`);
    }
    return String(value);
  }
  if (typeof value !== "string") {
    throw new TypeError(`${field} must be a number or decimal string`);
  }
  return value;
}

export function decimalToMinorUnits(
  value: MoneyInput,
  field: string,
  allowNegative = false,
): bigint {
  const text = decimalText(value, field);
  const pattern = allowNegative
    ? /^-?\d+(?:\.\d{1,2})?$/
    : /^\d+(?:\.\d{1,2})?$/;
  if (!pattern.test(text)) {
    throw new TypeError(`${field} must have at most two decimal places`);
  }
  const unsigned = text.startsWith("-") ? text.slice(1) : text;
  const [major, minor = ""] = unsigned.split(".");
  if (major.length > MAX_MAJOR_DIGITS) {
    throw new TypeError(`${field} exceeds the supported monetary range`);
  }
  const units = BigInt(major) * 100n + BigInt(minor.padEnd(2, "0"));
  return text.startsWith("-") ? -units : units;
}

export function minorUnitsToMoney(value: bigint): Money {
  const negative = value < 0n;
  const absolute = negative ? -value : value;
  const major = absolute / 100n;
  const minor = (absolute % 100n).toString().padStart(2, "0");
  const fraction = minor.endsWith("0") ? minor[0] : minor;
  const formatted = fraction === "0" ? major.toString() : `${major}.${fraction}`;
  return negative && absolute !== 0n ? `-${formatted}` : formatted;
}

export function parseMoney(value: MoneyInput, field: string): Money {
  const minor = decimalToMinorUnits(value, field);
  return minorUnitsToMoney(minor);
}

export function addMoney(left: Money, right: Money): Money {
  return minorUnitsToMoney(
    decimalToMinorUnits(left, "money value", true) +
      decimalToMinorUnits(right, "money value", true),
  );
}

export function subtractMoney(left: Money, right: Money): Money {
  return minorUnitsToMoney(
    decimalToMinorUnits(left, "money value", true) -
      decimalToMinorUnits(right, "money value", true),
  );
}

export function multiplyMoney(value: Money, multiplier: number): Money {
  if (!Number.isSafeInteger(multiplier) || multiplier < 0) {
    throw new TypeError("months must be a non-negative safe integer");
  }
  return minorUnitsToMoney(
    decimalToMinorUnits(value, "money value", true) * BigInt(multiplier),
  );
}

/** Divide money to the Python Decimal reference's 28 significant digits. */
export function divideMoney(value: Money, divisor: number): Money | null {
  if (!Number.isSafeInteger(divisor) || divisor <= 0) return null;
  const numerator = decimalToMinorUnits(value, "money value", true);
  const denominator = BigInt(divisor) * 100n;
  const whole = numerator / denominator;
  const precision = whole === 0n
    ? DECIMAL_PRECISION
    : Math.max(0, DECIMAL_PRECISION - whole.toString().replace("-", "").length);
  const scale = 10n ** BigInt(precision);
  const scaledNumerator = numerator * scale;
  let quotient = scaledNumerator / denominator;
  const remainder = scaledNumerator % denominator;
  const doubledRemainder = (remainder < 0n ? -remainder : remainder) * 2n;
  const absoluteDenominator = denominator < 0n ? -denominator : denominator;
  if (
    doubledRemainder > absoluteDenominator ||
    (doubledRemainder === absoluteDenominator && quotient % 2n !== 0n)
  ) {
    quotient += numerator < 0n ? -1n : 1n;
  }

  const negative = quotient < 0n;
  const absolute = negative ? -quotient : quotient;
  const integer = precision === 0 ? absolute : absolute / scale;
  const fraction = precision === 0
    ? ""
    : (absolute % scale).toString().padStart(precision, "0").replace(/0+$/, "");
  const formatted = fraction ? `${integer}.${fraction}` : integer.toString();
  return negative && absolute !== 0n ? `-${formatted}` : formatted;
}

export function moneyToNumber(value: Money): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) throw new TypeError("money value is out of range");
  return parsed;
}

