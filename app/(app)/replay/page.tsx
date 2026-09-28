import { headers } from "next/headers"
import { Rewind, LineChart, ShieldCheck, NotebookPen } from "lucide-react"
import { auth } from "@/lib/auth"
import { isPro } from "@/lib/subscription"
import { ReplayPage } from "@/components/replay/replay-page"
import { FeatureGateCard } from "@/components/feature-gate-card"

export const metadata = { title: "Trade Replay" }

export default async function ReplayRoute() {
  const session = await auth.api.getSession({ headers: await headers() })
  const pro = session?.user ? await isPro(session.user.id) : false
  // Pro-only, shown as "coming soon" while it's being finished — non-Pro users
  // get the preview screen; Pro (and the owner) get the live replay workspace.
  if (!pro) {
    return (
      <FeatureGateCard
        header="Trade Replay"
        headerDescription="Practice your setups, replay markets, and improve your decisions."
        badge="Coming soon"
        icon={Rewind}
        title="Replay any market, candle by candle"
        intro="We're putting the finishing touches on it. Here's what's on the way:"
        points={[
          { icon: Rewind, text: "Replay historical sessions candle-by-candle — no look-ahead, just like live." },
          { icon: LineChart, text: "Place simulated buys and sells with live P&L, risk and R:R." },
          { icon: ShieldCheck, text: "A prop-firm safety check that blocks rule-breaking trades before you place them." },
          { icon: NotebookPen, text: "Journal every replay trade and review a full session summary." },
        ]}
        cta={{ label: "See Pro plans", href: "/pricing" }}
      />
    )
  }
  return <ReplayPage />
}
