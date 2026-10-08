import type { FinancialTwin, GoalProgress } from "@/lib/api/client";
import { formatDate, formatMoney, formatMonths, humanizeCode } from "@/lib/formatting/financial";
import { StatusPanel } from "@/components/status-panel";

export function GoalsSection({ twin }: { twin: FinancialTwin }) {
  if (twin.raw.goals.length === 0) {
    return <StatusPanel title="No goals on this profile yet." description="Goals will appear here after they are added to your Financial Twin." />;
  }

  return (
    <div className="space-y-4">
      {twin.raw.goals.map((goal, index) => {
        const progress: GoalProgress | undefined = twin.derived.goals[index];
        const rawProvenance = twin.provenance.goalFields[index] ?? {};
        return (
          <article className="rounded-2xl border border-[var(--line)] bg-white p-5 shadow-[0_14px_42px_-36px_rgba(18,39,32,.4)] sm:p-6" key={`${goal.name}-${index}`}>
            <div className="flex flex-wrap items-start justify-between gap-3 border-b border-[var(--line)] pb-4">
              <div>
                <h3 className="text-base font-semibold text-[var(--ink)]">{goal.name}</h3>
                <p className="mt-1 text-xs text-[var(--muted)]">Target {goal.targetDate ? formatDate(goal.targetDate) : formatMonths(progress?.monthsRemaining)}</p>
              </div>
              <div className="flex flex-wrap gap-2">
                <span className="rounded-full border border-[var(--line)] px-2.5 py-1 text-[11px] font-medium text-[var(--muted)]">{humanizeCode(goal.status)}</span>
                {progress && <span className="rounded-full bg-[#f1f6f2] px-2.5 py-1 text-[11px] font-semibold text-[var(--accent)]">{humanizeCode(progress.status)}</span>}
              </div>
            </div>
            {progress ? (
              <dl className="mt-4 grid gap-x-6 gap-y-4 sm:grid-cols-2 xl:grid-cols-3">
                <GoalValue label="Target amount" value={formatMoney(progress.targetAmount, twin.raw.currency)} provenance={rawProvenance.targetAmount} />
                <GoalValue label="Current allocation" value={formatMoney(progress.currentAllocatedAmount, twin.raw.currency)} provenance={rawProvenance.currentAllocatedAmount} />
                <GoalValue label="Current funding gap" value={formatMoney(progress.currentFundingGap, twin.raw.currency)} provenance={twin.provenance.derived.goals} />
                <GoalValue label="Required monthly contribution" value={formatMoney(progress.requiredMonthlyContribution, twin.raw.currency)} provenance={twin.provenance.derived.goals} />
                <GoalValue label="Projected amount" value={formatMoney(progress.projectedAmount, twin.raw.currency)} provenance={twin.provenance.derived.goals} />
                <GoalValue label="Projected goal shortfall" value={formatMoney(progress.projectedGoalShortfall, twin.raw.currency)} provenance={twin.provenance.derived.goals} />
              </dl>
            ) : (
              <p className="mt-4 text-sm text-[var(--muted)]">Calculated goal values are unavailable.</p>
            )}
            {progress?.statusMessage && <p className="mt-4 text-sm leading-6 text-[var(--muted)]">{progress.statusMessage}</p>}
          </article>
        );
      })}
    </div>
  );
}

function GoalValue({ label, value, provenance }: { label: string; value: string; provenance?: string }) {
  return (
    <div>
      <dt className="text-xs text-[var(--muted)]">{label}</dt>
      <dd className="mt-1 break-words text-sm font-semibold text-[var(--ink)]">{value}</dd>
      {provenance && <dd className="mt-1 text-[10px] font-medium tracking-wide text-[var(--accent)]">{provenance}</dd>}
    </div>
  );
}
