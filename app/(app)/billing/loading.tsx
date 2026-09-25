import type React from "react"

// Skeleton for /billing, in the page's shape: header, then the plan card,
// plan details + usage, payment method and billing information, with
// billing history, saved cards and the billing note beside them.
function Bar({ className }: { className: string }) {
  return <div className={`animate-pulse rounded-md bg-muted ${className}`} />
}

function Card({ className = "", children }: { className?: string; children: React.ReactNode }) {
  return <div className={`rounded-2xl border bg-card p-4 @[640px]/page:p-5 ${className}`}>{children}</div>
}

export default function BillingLoading() {
  return (
    <div aria-busy="true" aria-label="Loading billing" className="@container/page">
      <div className="mx-auto max-w-[1400px] space-y-6 p-4 @[640px]/page:p-6 @[1100px]/page:p-8">
        <div className="space-y-2">
          <Bar className="h-3 w-40" />
          <Bar className="h-8 w-80 max-w-full" />
          <Bar className="h-4 w-[30rem] max-w-full" />
        </div>
        <div className="grid items-start gap-5 @[1080px]/page:grid-cols-[minmax(0,2fr)_minmax(320px,1fr)] @[1080px]/page:gap-6">
          <div className="space-y-5">
            <Card className="border-primary/20 @[640px]/page:p-7">
              <Bar className="h-6 w-20 rounded-full" />
              <Bar className="mt-4 h-8 w-44" />
              <Bar className="mt-3 h-4 w-96 max-w-full" />
              <div className="mt-5 grid gap-2 sm:grid-cols-2">
                {Array.from({ length: 4 }, (_, i) => (
                  <Bar key={i} className="h-4 w-40" />
                ))}
              </div>
              <div className="mt-6 flex gap-2">
                <Bar className="h-11 w-36 rounded-lg" />
                <Bar className="h-11 w-44 rounded-lg" />
              </div>
            </Card>
            <Card>
              <Bar className="h-5 w-28" />
              <div className="mt-4 space-y-3">
                {Array.from({ length: 4 }, (_, i) => (
                  <Bar key={i} className="h-4 w-full max-w-md" />
                ))}
              </div>
            </Card>
            <Card>
              <Bar className="h-5 w-36" />
              <div className="mt-4 flex items-center gap-3">
                <Bar className="h-8 w-[42px]" />
                <Bar className="h-4 w-48" />
              </div>
            </Card>
          </div>
          <div className="space-y-5">
            <Card>
              <Bar className="h-5 w-32" />
              <div className="mt-4 space-y-3">
                {Array.from({ length: 4 }, (_, i) => (
                  <Bar key={i} className="h-10 w-full" />
                ))}
              </div>
            </Card>
            <Card>
              <Bar className="h-5 w-36" />
              <Bar className="mt-4 h-16 w-full rounded-xl" />
            </Card>
          </div>
        </div>
      </div>
    </div>
  )
}
