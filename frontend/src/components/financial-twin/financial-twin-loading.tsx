export function FinancialTwinLoading() {
  return (
    <div className="space-y-8" aria-label="Loading Financial Twin" role="status">
      <div className="space-y-3">
        <div className="h-3 w-32 animate-pulse rounded bg-[#dfe6e1]" />
        <div className="h-8 w-64 max-w-full animate-pulse rounded bg-[#e5ebe7]" />
        <span className="sr-only">Checking your account and loading your Financial Twin.</span>
      </div>
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
        {Array.from({ length: 6 }, (_, index) => <div className="h-36 animate-pulse rounded-2xl border border-[var(--line)] bg-white" key={index} />)}
      </div>
      <div className="h-56 animate-pulse rounded-2xl border border-[var(--line)] bg-white" />
    </div>
  );
}
