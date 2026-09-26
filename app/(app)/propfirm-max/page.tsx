import { headers } from "next/headers"
import { Gauge, ShieldCheck, TrendingDown, Bell, Layers } from "lucide-react"
import { auth } from "@/lib/auth"
import { isPro } from "@/lib/subscription"
import { getPropMaxData, getPropMaxAlerts } from "@/app/actions/propmax"
import { PropMaxWorkspace } from "@/components/propmax/propmax-workspace"
import { FeatureGateCard } from "@/components/feature-gate-card"

export const metadata = { title: "Propfirm Tracker" }

export default async function PropFirmMaxPage() {
  const session = await auth.api.getSession({ headers: await headers() })
  const pro = session?.user ? await isPro(session.user.id) : false
  // Pro-only, and shown as "coming soon" while it's being finished — non-Pro
  // users get the preview screen; Pro (and the owner) see the live tracker.
  if (!pro) {
    return (
      <FeatureGateCard
        header="Propfirm Tracker"
        headerDescription="Track every prop-firm account against its real rules."
        badge="Coming soon"
        icon={Gauge}
        title="A rule-aware tracker for every prop-firm account"
        intro="We're putting the finishing touches on it. Here's what's on the way:"
        points={[
          { icon: ShieldCheck, text: "Real, sourced rules for 40+ forex and futures firms — nothing guessed." },
          { icon: TrendingDown, text: "Live drawdown, daily-loss and profit-target progress for each account." },
          { icon: Bell, text: "Alerts the moment an account nears a breach or becomes payout-eligible." },
          { icon: Layers, text: "One command center across every firm, phase and account size." },
        ]}
        cta={{ label: "See Pro plans", href: "/pricing" }}
      />
    )
  }
  const [{ accounts, catalog }, alerts] = await Promise.all([getPropMaxData(), getPropMaxAlerts()])
  return <PropMaxWorkspace accounts={accounts} catalog={catalog} alerts={alerts} />
}
