// Shown while a portal page's data loads, shaped like the page header plus
// the KPI row and panels most of these pages open with.
function Block({ className }: { className: string }) {
  return <div className={`animate-pulse rounded-md bg-muted ${className}`} />
}

export default function Loading() {
  return (
    <div role="status" aria-label="Loading">
      <div className="border-b px-4 py-4 sm:px-6 sm:py-5">
        <Block className="h-6 w-40" />
        <Block className="mt-2 h-4 w-64" />
      </div>
      <div className="flex flex-col gap-4 p-4 sm:p-6">
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          {Array.from({ length: 4 }, (_, i) => (
            <Block key={i} className="h-24 rounded-xl" />
          ))}
        </div>
        <Block className="h-72 rounded-xl" />
        <Block className="h-56 rounded-xl" />
      </div>
    </div>
  )
}
