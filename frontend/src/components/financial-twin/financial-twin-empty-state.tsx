import { StatusPanel } from "@/components/status-panel";

export function FinancialTwinEmptyState() {
  return (
    <StatusPanel
      eyebrow="Financial Twin not configured"
      title="Your Financial Twin has not been set up yet."
      description="Once your financial profile exists, NEXUS will show your income, expenses, savings, debt, investments, goals and risk indicators here. No financial values have been filled in."
      tone="warning"
    />
  );
}
