import { Shimmer } from "@/components/affiliate/v2/ui"

// What every V2 page shows while its data loads: the shape of a page, never a blank screen.
export default function AffiliateV2Loading() {
  return (
    <div className="mx-auto w-full max-w-[1500px] space-y-4 p-4 sm:p-5 lg:space-y-5 lg:p-6" aria-busy="true" aria-label="Loading">
      <div className="grid gap-4 lg:grid-cols-3">
        <div className="v2-card h-44 p-5 lg:col-span-2">
          <Shimmer className="h-5 w-40" />
          <Shimmer className="mt-4 h-8 w-64" />
          <Shimmer className="mt-3 h-4 w-72" />
        </div>
        <div className="v2-card h-44 p-5">
          <Shimmer className="h-5 w-32" />
          <Shimmer className="mt-4 h-10 w-full" />
          <Shimmer className="mt-2 h-10 w-full" />
        </div>
      </div>
      <div className="grid grid-cols-2 gap-3 sm:gap-4 xl:grid-cols-4">
        {Array.from({ length: 4 }, (_, i) => (
          <div key={i} className="v2-card flex items-center gap-3 p-4">
            <Shimmer className="size-12 rounded-2xl" />
            <div className="flex-1 space-y-2">
              <Shimmer className="h-3 w-20" />
              <Shimmer className="h-6 w-24" />
            </div>
          </div>
        ))}
      </div>
      <div className="grid gap-4 lg:grid-cols-3">
        <div className="v2-card h-80 p-5 lg:col-span-2">
          <Shimmer className="h-5 w-40" />
          <Shimmer className="mt-5 h-56 w-full rounded-xl" />
        </div>
        <div className="v2-card h-80 space-y-4 p-5">
          <Shimmer className="h-5 w-40" />
          {Array.from({ length: 4 }, (_, i) => (
            <Shimmer key={i} className="h-8 w-full" />
          ))}
        </div>
      </div>
    </div>
  )
}
