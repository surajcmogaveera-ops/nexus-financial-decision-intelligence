import { StatusPanel } from "@/components/status-panel";

export function DashboardError({ message, onRetry }: { message: string; onRetry: () => void }) {
  return (
    <StatusPanel
      eyebrow="Dashboard unavailable"
      title="Your workspace could not be loaded."
      description={message}
      action={{ label: "Try again", onClick: onRetry }}
      tone="error"
    />
  );
}
