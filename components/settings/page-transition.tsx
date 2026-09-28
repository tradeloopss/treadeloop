"use client"

import type React from "react"
import { usePathname } from "next/navigation"

// Fades/slides each settings page in when the route changes. Keying on the
// pathname re-triggers the entrance animation on every nav within Settings.
export function SettingsPageTransition({ children }: { children: React.ReactNode }) {
  const pathname = usePathname()
  return (
    <div key={pathname} className="animate-in fade-in slide-in-from-bottom-1 duration-300 ease-out">
      {children}
    </div>
  )
}
