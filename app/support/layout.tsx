import type React from "react"
import Link from "next/link"
import { redirect } from "next/navigation"
import { headers } from "next/headers"
import { ArrowLeft } from "lucide-react"
import { auth } from "@/lib/auth"
import { BrandMark } from "@/components/brand-mark"

// Support lives outside the (app) group on purpose: that layout puts a
// paywall over everything for users without a plan, and those are often the
// people who most need to reach support (billing trouble, a lapsed trial).
export default async function SupportLayout({ children }: { children: React.ReactNode }) {
  const session = await auth.api.getSession({ headers: await headers() })
  if (!session?.user) redirect("/sign-in?next=/support")

  return (
    <div className="min-h-svh bg-background">
      <header className="flex h-14 items-center justify-between border-b bg-sidebar px-4 sm:px-6">
        <Link href="/dashboard" className="flex items-center gap-2">
          <BrandMark className="size-7" />
          <span className="font-semibold tracking-tight">TradeLoop</span>
        </Link>
        <Link href="/dashboard" className="flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground">
          <ArrowLeft className="size-4" /> Back to app
        </Link>
      </header>
      {children}
    </div>
  )
}
