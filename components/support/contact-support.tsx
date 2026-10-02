"use client"

import { Suspense, createContext, lazy, useCallback, useContext, useState } from "react"
import type { SupportCategory } from "@/lib/support/request"

// The Contact Support window, available everywhere: one dialog mounted at the
// root (app/layout.tsx), opened from any link or button on any page, signed in
// or not. The dialog's own code loads the first time it is opened.

export type ContactSupportOptions = {
  // the subject to start on ("payout" from a payouts page, "billing" from billing…)
  category?: SupportCategory
}

const ContactSupportDialog = lazy(() => import("./contact-support-dialog").then((m) => ({ default: m.ContactSupportDialog })))

const Ctx = createContext<(options?: ContactSupportOptions) => void>(() => {})

// const openSupport = useContactSupport(); openSupport({ category: "payout" })
export const useContactSupport = () => useContext(Ctx)

export function ContactSupportProvider({ children }: { children: React.ReactNode }) {
  // `asked` counts openings, so the dialog can pick up the category of each one.
  const [state, setState] = useState<{ open: boolean; asked: number; options: ContactSupportOptions }>({ open: false, asked: 0, options: {} })
  const open = useCallback((options: ContactSupportOptions = {}) => setState((s) => ({ open: true, asked: s.asked + 1, options })), [])
  return (
    <Ctx.Provider value={open}>
      {children}
      {state.asked > 0 && (
        <Suspense fallback={null}>
          <ContactSupportDialog open={state.open} onOpenChange={(next) => setState((s) => ({ ...s, open: next }))} asked={state.asked} defaultCategory={state.options.category} />
        </Suspense>
      )}
    </Ctx.Provider>
  )
}

// A link or button that opens the window. Looks like whatever `className` says.
export function ContactSupportTrigger({ category, className, children }: { category?: SupportCategory; className?: string; children: React.ReactNode }) {
  const open = useContactSupport()
  return (
    <button type="button" onClick={() => open({ category })} className={className}>
      {children}
    </button>
  )
}
