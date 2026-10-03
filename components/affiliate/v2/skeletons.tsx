import { Shimmer } from "./ui"

// What the Wallet and Payout pages show while their data loads: the shape of
// the page that is coming, so nothing jumps when it arrives.

const frame = "mx-auto w-full max-w-[1500px] space-y-4 p-4 sm:p-5 lg:space-y-5 lg:p-6"

function RowSkeleton() {
  return (
    <div className="flex items-center gap-3 rounded-2xl border bg-background/30 p-3">
      <Shimmer className="size-10 shrink-0 rounded-xl" />
      <div className="flex-1 space-y-2">
        <Shimmer className="h-3.5 w-28" />
        <Shimmer className="h-3 w-40 max-w-full" />
      </div>
      <div className="flex flex-col items-end gap-2">
        <Shimmer className="h-3.5 w-16" />
        <Shimmer className="h-4 w-14 rounded-full" />
      </div>
    </div>
  )
}

function Heading() {
  return (
    <div className="space-y-2 md:hidden">
      <Shimmer className="h-6 w-28" />
      <Shimmer className="h-4 w-64 max-w-full" />
    </div>
  )
}

export function ListSkeleton({ rows = 6 }: { rows?: number }) {
  return (
    <div className={frame} aria-busy="true" aria-label="Loading">
      <Heading />
      <div className="v2-card space-y-2 p-4 sm:p-5">
        <Shimmer className="mb-3 h-5 w-44" />
        {Array.from({ length: rows }, (_, i) => (
          <RowSkeleton key={i} />
        ))}
      </div>
    </div>
  )
}

export function WalletSkeleton() {
  return (
    <div className={frame} aria-busy="true" aria-label="Loading your wallet">
      <Heading />
      <div className="grid gap-3 sm:gap-4 lg:grid-cols-5 lg:gap-5">
        <div className="v2-card-glow p-4 sm:p-5 lg:col-span-2">
          <Shimmer className="h-4 w-24" />
          <Shimmer className="mt-3 h-9 w-44" />
          <Shimmer className="mt-3 h-4 w-32" />
          <Shimmer className="mt-4 h-16 w-full rounded-xl" />
        </div>
        <div className="grid grid-cols-2 gap-3 sm:gap-4 lg:col-span-3">
          {Array.from({ length: 4 }, (_, i) => (
            <div key={i} className="v2-card space-y-2.5 p-3.5 sm:p-4">
              <div className="flex items-center gap-2">
                <Shimmer className="size-8 rounded-xl" />
                <Shimmer className="h-3 w-20" />
              </div>
              <Shimmer className="h-6 w-24" />
              <Shimmer className="h-3 w-16" />
            </div>
          ))}
        </div>
      </div>
      <div className="grid gap-4 lg:grid-cols-5 lg:gap-5">
        <div className="v2-card space-y-2 p-4 sm:p-5 lg:col-span-2">
          <Shimmer className="mb-3 h-5 w-36" />
          <RowSkeleton />
          <RowSkeleton />
          <Shimmer className="mt-3 h-12 w-full rounded-xl" />
        </div>
        <div className="v2-card space-y-2 p-4 sm:p-5 lg:col-span-3">
          <Shimmer className="h-5 w-44" />
          <div className="flex gap-1.5 py-2">
            {["w-14", "w-20", "w-[72px]", "w-[72px]", "w-24"].map((w, i) => (
              <Shimmer key={i} className={`h-9 shrink-0 rounded-full ${w}`} />
            ))}
          </div>
          {Array.from({ length: 5 }, (_, i) => (
            <RowSkeleton key={i} />
          ))}
        </div>
      </div>
    </div>
  )
}

export function PayoutSkeleton() {
  return (
    <div className={frame} aria-busy="true" aria-label="Loading payouts">
      <Heading />
      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(320px,400px)] lg:gap-5">
        <div className="space-y-4 lg:space-y-5">
          <div className="rounded-[22px] border border-white/10 bg-[#08102a] p-4 sm:min-h-[212px] sm:p-7">
            <Shimmer className="h-4 w-36 bg-white/10" />
            <Shimmer className="mt-3 h-10 w-48 bg-white/10" />
            <Shimmer className="mt-6 h-4 w-40 bg-white/10" />
          </div>
          <div className="v2-card space-y-2 p-4 sm:p-5">
            <Shimmer className="mb-3 h-5 w-52" />
            <RowSkeleton />
            <RowSkeleton />
            <Shimmer className="mt-3 h-12 w-full rounded-xl" />
          </div>
          <div className="v2-card space-y-3 p-4 sm:p-5">
            <Shimmer className="h-5 w-36" />
            <Shimmer className="h-16 w-full rounded-2xl" />
            <div className="grid grid-cols-4 gap-2">
              {Array.from({ length: 4 }, (_, i) => (
                <Shimmer key={i} className="h-11 rounded-xl" />
              ))}
            </div>
          </div>
        </div>
        <div className="space-y-4 lg:space-y-5">
          <div className="v2-card-glow space-y-3 p-4 sm:p-5">
            <Shimmer className="h-5 w-36" />
            <Shimmer className="h-4 w-full" />
            <Shimmer className="h-4 w-full" />
            <Shimmer className="h-14 w-full rounded-2xl" />
          </div>
          <div className="v2-card space-y-2 p-4 sm:p-5">
            <Shimmer className="mb-3 h-5 w-36" />
            <RowSkeleton />
            <RowSkeleton />
            <RowSkeleton />
          </div>
        </div>
      </div>
    </div>
  )
}
