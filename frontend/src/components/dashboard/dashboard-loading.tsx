export function DashboardLoading() {
  return (
    <div className="space-y-8" aria-label="Loading dashboard" role="status">
      <div className="space-y-3">
        <div className="h-3 w-32 animate-pulse rounded bg-[#dfe6e1]" />
        <div className="h-8 w-64 max-w-full animate-pulse rounded bg-[#e5ebe7]" />
      </div>
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
        {Array.from({ length: 5 }, (_, index) => <div className="h-36 animate-pulse rounded-2xl border border-[var(--line)] bg-white" key={index} />)}
      </div>
      <div className="grid gap-4 lg:grid-cols-2">
        {Array.from({ length: 2 }, (_, index) => <div className="h-52 animate-pulse rounded-2xl border border-[var(--line)] bg-white" key={index} />)}
      </div>
      <span className="sr-only">Checking your account and loading financial information.</span>
    </div>
  );
}
