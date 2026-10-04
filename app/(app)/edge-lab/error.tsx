"use client"

// A failure in one screen: say so plainly, and offer to try again.
export default function InsightError({ reset }: { error: Error; reset: () => void }) {
  return (
    <div className="rounded-xl border border-dashed p-8 text-center">
      <p className="text-sm font-medium">Edge Lab couldn't load this page.</p>
      <p className="mt-1 text-sm text-muted-foreground">Your trades and what you saved are untouched. Try again in a moment.</p>
      <button type="button" onClick={reset} className="mt-4 inline-flex h-8 items-center rounded-md bg-primary px-3 text-sm font-medium text-primary-foreground hover:bg-primary/90">
        Try again
      </button>
    </div>
  )
}
