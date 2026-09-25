// Skeleton for /accounts, in the same shape as the page: the connection
// workspace (platform rows) and the connected-accounts panel.
function Bar({ className }: { className: string }) {
  return <div className={`animate-pulse rounded-md bg-muted ${className}`} />
}

export default function AccountsLoading() {
  return (
    <div aria-busy="true" aria-label="Loading accounts">
      <div className="flex h-14 items-center border-b px-4 md:h-16 md:px-5">
        <Bar className="h-3.5 w-36" />
      </div>
      <div className="@container/page">
        <div className="grid items-start gap-4 p-4 @[640px]/page:p-5 @[900px]/page:grid-cols-[minmax(0,1fr)_340px] @[1180px]/page:grid-cols-[minmax(0,1fr)_420px] @[1500px]/page:grid-cols-[minmax(0,1fr)_440px]">
          <div className="rounded-[14px] border bg-card p-4 @[640px]/page:p-6">
            <Bar className="h-3 w-20" />
            <Bar className="mt-3 h-8 w-72 max-w-full" />
            <Bar className="mt-3 h-4 w-96 max-w-full" />
            <div className="mt-8 grid gap-3">
              {Array.from({ length: 6 }, (_, i) => (
                <div key={i} className="flex min-h-[72px] items-center gap-3 rounded-[10px] border p-4">
                  <Bar className="size-11 shrink-0 rounded-[10px]" />
                  <div className="min-w-0 flex-1 space-y-2">
                    <Bar className="h-3.5 w-28" />
                    <Bar className="h-3 w-44 max-w-full" />
                  </div>
                </div>
              ))}
            </div>
          </div>
          <div className="rounded-[14px] border bg-card p-4 @[640px]/page:p-5">
            <Bar className="h-5 w-48" />
            <Bar className="mt-2 h-3 w-64 max-w-full" />
            {Array.from({ length: 2 }, (_, i) => (
              <div key={i} className="mt-4 rounded-xl border">
                <div className="flex items-center gap-3 p-4">
                  <Bar className="size-10 shrink-0 rounded-[10px]" />
                  <div className="flex-1 space-y-2">
                    <Bar className="h-3.5 w-32" />
                    <Bar className="h-3 w-24" />
                  </div>
                </div>
                <div className="grid grid-cols-3 gap-3 border-t px-4 py-3">
                  {Array.from({ length: 3 }, (_, j) => (
                    <div key={j} className="space-y-1.5">
                      <Bar className="h-2.5 w-12" />
                      <Bar className="h-3.5 w-16" />
                    </div>
                  ))}
                </div>
                <div className="border-t px-4 py-3">
                  <Bar className="h-3 w-36" />
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  )
}
