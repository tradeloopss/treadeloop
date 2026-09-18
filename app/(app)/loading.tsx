// Shown the instant a sidebar link is clicked, while the page's data loads —
// without it the previous page stays frozen on screen until the server
// responds. Next.js prefetches this fallback, and the sidebar (in the
// layout) stays interactive around it. Shaped like PageHeader plus the
// card grid most pages open with, so the swap-in doesn't jump.
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
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {Array.from({ length: 4 }, (_, i) => (
            <Block key={i} className="h-24 rounded-xl" />
          ))}
        </div>
        <div className="grid gap-4 lg:grid-cols-3">
          <Block className="h-72 rounded-xl lg:col-span-2" />
          <Block className="h-72 rounded-xl" />
        </div>
      </div>
    </div>
  )
}
