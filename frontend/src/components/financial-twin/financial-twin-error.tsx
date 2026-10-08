import { StatusPanel } from "@/components/status-panel";

export function FinancialTwinError({ message, onRetry }: { message: string; onRetry: () => void }) {
  return (
    <StatusPanel
      eyebrow="Financial Twin unavailable"
      title="Your financial state could not be loaded."
      description={message}
      action={{ label: "Try again", onClick: onRetry }}
      tone="error"
    />
  );
}
