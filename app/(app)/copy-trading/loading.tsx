// Shown while a Copy Trading page loads: the shape of what is coming, never a blank page.
export default function Loading() {
  return (
    <div className="space-y-4 p-4 sm:p-6" aria-busy="true" aria-label="Loading">
      <div className="h-10 w-64 max-w-full animate-pulse rounded-lg bg-muted" />
      <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
        {Array.from({ length: 6 }, (_, i) => (
          <div key={i} className="h-20 animate-pulse rounded-xl bg-muted" />
        ))}
      </div>
      <div className="h-72 animate-pulse rounded-xl bg-muted" />
      <div className="grid gap-4 lg:grid-cols-2">
        <div className="h-48 animate-pulse rounded-xl bg-muted" />
        <div className="h-48 animate-pulse rounded-xl bg-muted" />
      </div>
    </div>
  )
}
