import { StatusPanel } from "@/components/status-panel";

export function RecentScenarios() {
  return (
    <StatusPanel
      eyebrow="History unavailable"
      title="Recent scenarios cannot be listed yet."
      description="NEXUS can save an authenticated simulation, but the Node API does not currently provide an endpoint to list saved scenarios. No scenario history has been invented."
      tone="warning"
    />
  );
}
