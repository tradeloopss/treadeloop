// Skeleton for /accounts, in the same shape as the page: header, the
// connection card (platform tiles) and the account list.
function Bar({ className }: { className: string }) {
  return <div className={`animate-pulse rounded-md bg-muted ${className}`} />
}

export default function AccountsLoading() {
  return (
    <div aria-busy="true" aria-label="Loading accounts" className="@container/page">
      <div className="space-y-6 p-4 @[640px]/page:p-6 @[1100px]/page:space-y-8 @[1100px]/page:p-8">
        <div className="flex items-start justify-between gap-4">
          <div className="space-y-2">
            <Bar className="h-8 w-40" />
            <Bar className="h-4 w-80 max-w-full" />
          </div>
          <Bar className="h-10 w-10 rounded-[9px] @[640px]/page:w-36" />
        </div>

        <div className="rounded-2xl border bg-card p-4 @[640px]/page:p-6 @[1100px]/page:p-8">
          <Bar className="h-4 w-72 max-w-full" />
          <Bar className="mt-6 h-7 w-64 max-w-full" />
          <Bar className="mt-3 h-4 w-[28rem] max-w-full" />
          <div className="mt-7 grid gap-3 @[640px]/page:grid-cols-2 @[1000px]/page:grid-cols-3">
            {Array.from({ length: 6 }, (_, i) => (
              <div key={i} className="flex min-h-[76px] items-center gap-3 rounded-[10px] border px-4 py-3">
                <Bar className="size-10 shrink-0 rounded-[10px]" />
                <div className="min-w-0 flex-1 space-y-2">
                  <Bar className="h-3.5 w-24" />
                  <Bar className="h-3 w-40 max-w-full" />
                </div>
              </div>
            ))}
          </div>
        </div>

        <div>
          <Bar className="h-5 w-48" />
          <div className="mt-3 overflow-hidden rounded-[14px] border bg-card">
            {Array.from({ length: 3 }, (_, i) => (
              <div key={i} className="flex min-h-[72px] items-center gap-4 border-b px-5 py-3 last:border-b-0">
                <Bar className="size-10 shrink-0 rounded-[10px]" />
                <div className="min-w-0 flex-1 space-y-2">
                  <Bar className="h-3.5 w-48 max-w-full" />
                  <Bar className="h-3 w-28" />
                </div>
                <Bar className="hidden h-6 w-24 rounded-full @[640px]/page:block" />
                <Bar className="hidden h-4 w-20 @[640px]/page:block" />
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  )
}
