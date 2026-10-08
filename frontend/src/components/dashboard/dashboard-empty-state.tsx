import { StatusPanel } from "@/components/status-panel";

export function DashboardEmptyState() {
  return (
    <StatusPanel
      eyebrow="Financial Twin not configured"
      title="Set up your financial profile to see your position here."
      description="There is no saved Financial Twin profile for this account. NEXUS has not created one or filled in any financial values."
      tone="warning"
    />
  );
}
