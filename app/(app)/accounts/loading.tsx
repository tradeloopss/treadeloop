// Skeleton for /accounts, in the same shape as the page: header, then the
// connection card (platform tiles), the account list and the side note —
// arranged by the same width breakpoints as components/accounts/accounts-hub.
function Bar({ className }: { className: string }) {
  return <div className={`animate-pulse rounded-md bg-muted ${className}`} />
}

export default function AccountsLoading() {
  return (
    <div aria-busy="true" aria-label="Loading accounts" className="@container/page">
      <div className="space-y-5 p-4 @[640px]/page:p-6">
        <div className="flex items-start justify-between gap-4">
          <div className="space-y-2">
            <Bar className="h-3 w-28" />
            <Bar className="h-8 w-40" />
            <Bar className="h-4 w-80 max-w-full" />
          </div>
          <Bar className="h-10 w-32 rounded-[9px]" />
        </div>

        <div className="grid items-start gap-5 @[1000px]/page:grid-cols-[minmax(0,2fr)_minmax(0,3fr)] @[1180px]/page:grid-cols-[minmax(0,1fr)_300px]">
          <div className="@container/ws rounded-2xl border bg-card p-4 @[640px]/page:p-5 @[1180px]/page:col-start-1">
            <Bar className="h-3 w-24" />
            <Bar className="mt-3 h-6 w-64 max-w-full" />
            <Bar className="mt-2 h-4 w-[28rem] max-w-full" />
            <Bar className="mt-5 h-6 w-[32rem] max-w-full" />
            <div className="mt-7 grid gap-2.5 @[520px]/ws:grid-cols-2 @[520px]/ws:gap-3 @[880px]/ws:grid-cols-3">
              {Array.from({ length: 6 }, (_, i) => (
                <div key={i} className="flex min-h-14 items-center gap-3 rounded-xl border px-3.5 py-2.5 @[480px]/ws:min-h-[76px]">
                  <Bar className="size-9 shrink-0 rounded-[9px] @[480px]/ws:size-10" />
                  <div className="min-w-0 flex-1 space-y-2">
                    <Bar className="h-3.5 w-24" />
                    <Bar className="hidden h-3 w-40 max-w-full @[480px]/ws:block" />
                  </div>
                </div>
              ))}
            </div>
          </div>

          <div className="rounded-2xl border bg-card p-4 @[640px]/page:p-5 @[1180px]/page:col-start-1">
            <Bar className="h-5 w-44" />
            <div className="mt-4 overflow-hidden rounded-xl border">
              {Array.from({ length: 3 }, (_, i) => (
                <div key={i} className="flex min-h-[60px] items-center gap-3 border-b px-4 py-2.5 last:border-b-0">
                  <Bar className="size-8 shrink-0 rounded-lg" />
                  <div className="min-w-0 flex-1 space-y-2">
                    <Bar className="h-3.5 w-48 max-w-full" />
                    <Bar className="h-3 w-28" />
                  </div>
                  <Bar className="hidden h-6 w-24 rounded-full @[640px]/page:block" />
                </div>
              ))}
            </div>
          </div>

          <div className="rounded-2xl border bg-card p-4 @[640px]/page:p-5 @[1000px]/page:col-span-2 @[1180px]/page:col-span-1 @[1180px]/page:col-start-2 @[1180px]/page:row-span-2 @[1180px]/page:row-start-1">
            <Bar className="h-5 w-56 max-w-full" />
            <div className="mt-4 space-y-4">
              {Array.from({ length: 3 }, (_, i) => (
                <div key={i} className="flex gap-3">
                  <Bar className="size-5 shrink-0 rounded-full" />
                  <div className="min-w-0 flex-1 space-y-1.5">
                    <Bar className="h-3.5 w-32" />
                    <Bar className="h-3 w-full" />
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
