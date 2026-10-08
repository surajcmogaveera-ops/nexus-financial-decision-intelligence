import { FinancialMetricCard } from "@/components/dashboard/financial-metric-card";
import { formatMonths } from "@/lib/formatting/financial";

export function EmergencyCoverage({ value, provenance }: { value: number | null; provenance?: string }) {
  return (
    <FinancialMetricCard
      label="Emergency coverage"
      value={formatMonths(value)}
      provenance={provenance}
      detail="Based on the backend's calculated coverage"
    />
  );
}
