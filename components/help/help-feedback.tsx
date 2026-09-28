"use client"

import { useState } from "react"

// A lightweight "Was this helpful?" widget. Records the choice in local state
// only (no backend) — enough to acknowledge the reader.
export function HelpFeedback() {
  const [picked, setPicked] = useState<number | null>(null)
  return (
    <div className="mt-10 rounded-2xl bg-muted/50 p-6 text-center">
      {picked == null ? (
        <>
          <p className="text-sm font-medium text-muted-foreground">Did this answer your question?</p>
          <div className="mt-3 flex justify-center gap-5">
            {["😞", "😐", "😃"].map((e, i) => (
              <button key={i} type="button" onClick={() => setPicked(i)} aria-label={["Not helpful", "Somewhat", "Helpful"][i]} className="text-2xl transition-transform hover:scale-110">
                {e}
              </button>
            ))}
          </div>
        </>
      ) : (
        <p className="text-sm font-medium text-muted-foreground">Thanks for your feedback! 🙌</p>
      )}
    </div>
  )
}
