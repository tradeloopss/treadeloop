import type React from "react"
import Link from "next/link"
import { notFound } from "next/navigation"
import { getAdmin } from "@/lib/admin/guard"
import { BacktestNav } from "@/components/backtest/backtest-nav"
import { buttonVariants } from "@/components/ui/button"
import { getT } from "@/lib/i18n/server"
import { Plus } from "lucide-react"

// The Backtesting section shell: its own header + sub-tabs (Dashboard /
// Sessions / Reports), separate from the rest of the app. Admin-only; a
// non-admin who deep-links here gets a 404 (the nav sends them to /backtest,
// which shows the coming-soon screen).
export default async function BacktestSectionLayout({ children }: { children: React.ReactNode }) {
  if (!(await getAdmin())) notFound()
  const t = await getT()
  return (
    <div>
      <div className="flex items-center justify-between gap-3 border-b px-4 py-3 sm:px-6">
        <h1 className="text-lg font-semibold tracking-tight">{t("Backtesting")}</h1>
        <Link href="/backtest/sessions" className={buttonVariants({ size: "sm" })}>
          <Plus className="size-4" /> {t("Create Session")}
        </Link>
      </div>
      <BacktestNav />
      {children}
    </div>
  )
}
