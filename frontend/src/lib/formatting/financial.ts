export function formatMoney(value: string | null | undefined, currency: string | undefined): string {
  if (value === null || value === undefined || !currency || !/^-?\d+(?:\.\d+)?$/.test(value)) return "Unavailable";

  try {
    const locale = currency === "INR" ? "en-IN" : "en-US";
    const formatter = new Intl.NumberFormat(locale, {
      style: "currency",
      currency,
      minimumFractionDigits: 0,
      maximumFractionDigits: 0,
    });
    const fractionDigits = new Intl.NumberFormat(locale, { style: "currency", currency }).resolvedOptions().maximumFractionDigits ?? 2;
    const negative = value.startsWith("-");
    const [wholeText, fractionText = ""] = (negative ? value.slice(1) : value).split(".");
    const scale = 10n ** BigInt(fractionDigits);
    let minor = BigInt(wholeText) * scale;
    const fraction = fractionText.slice(0, fractionDigits).padEnd(fractionDigits, "0");
    if (fractionDigits > 0 && fraction) minor += BigInt(fraction);
    if (fractionText.length > fractionDigits && Number(fractionText[fractionDigits]) >= 5) minor += 1n;

    const whole = minor / scale;
    const remainder = minor % scale;
    const signedWhole = negative && minor !== 0n ? -whole : whole;
    const parts = negative && minor > 0n && whole === 0n
      ? formatter.formatToParts(-1n).filter((part) => part.type !== "group").map((part) => part.type === "integer" ? { ...part, value: "0" } : part)
      : formatter.formatToParts(signedWhole);
    if (fractionDigits > 0 && remainder > 0n) {
      const lastInteger = parts.findLastIndex((part) => part.type === "integer");
      parts.splice(lastInteger + 1, 0,
        { type: "decimal", value: new Intl.NumberFormat(locale).formatToParts(1.1).find((part) => part.type === "decimal")?.value ?? "." },
        { type: "fraction", value: remainder.toString().padStart(fractionDigits, "0").replace(/0+$/, "") },
      );
    }
    return parts.map((part) => part.value).join("");
  } catch {
    return `${value} ${currency}`;
  }
}

export function formatMonths(value: number | null | undefined): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return "Unavailable";
  return `${new Intl.NumberFormat("en-IN", { minimumFractionDigits: 1, maximumFractionDigits: 1 }).format(value)} months`;
}

export function formatPercentage(value: number | null | undefined): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return "Unavailable";
  return new Intl.NumberFormat("en-IN", { style: "percent", maximumFractionDigits: 1 }).format(value);
}

export function formatDate(value: string | null | undefined): string {
  if (!value) return "Unavailable";
  const date = new Date(`${value.slice(0, 10)}T00:00:00.000Z`);
  if (Number.isNaN(date.getTime())) return "Unavailable";
  return new Intl.DateTimeFormat("en-IN", { dateStyle: "medium", timeZone: "UTC" }).format(date);
}

export function humanizeCode(value: string): string {
  return value.toLowerCase().split("_").map((word) => word ? word[0]!.toUpperCase() + word.slice(1) : word).join(" ");
}
