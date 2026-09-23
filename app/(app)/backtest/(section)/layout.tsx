import type React from "react"
import { notFound } from "next/navigation"
import { getAdmin } from "@/lib/admin/guard"
import { getPlaybooks } from "@/app/actions/playbooks"
import { BacktestNav } from "@/components/backtest/backtest-nav"
import { CreateSessionDialog } from "@/components/backtest/create-session-dialog"
import { getT } from "@/lib/i18n/server"

// The Backtesting section shell: its own header + sub-tabs (Dashboard /
// Sessions / Reports), separate from the rest of the app. Admin-only; a
// non-admin who deep-links here gets a 404 (the nav sends them to /backtest,
// which shows the coming-soon screen).
export default async function BacktestSectionLayout({ children }: { children: React.ReactNode }) {
  if (!(await getAdmin())) notFound()
  const t = await getT()
  const playbooks = await getPlaybooks()
  return (
    <div>
      <div className="flex items-center justify-between gap-3 border-b px-4 py-3 sm:px-6">
        <h1 className="text-lg font-semibold tracking-tight">{t("Backtesting")}</h1>
        <CreateSessionDialog playbooks={playbooks.map((p) => ({ id: p.id, name: p.name }))} />
      </div>
      <BacktestNav />
      {children}
    </div>
  )
}
