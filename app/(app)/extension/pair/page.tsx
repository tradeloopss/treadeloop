import { auth } from "@/lib/auth"
import { headers } from "next/headers"
import { redirect } from "next/navigation"
import { isPro } from "@/lib/subscription"
import { EXTENSION_DOWNLOAD_PATH, EXTENSION_STORE_URL, freshPairingFor, pairingBaseUrl } from "@/lib/tradingview-pairing"
import { tradingviewBookmarklet } from "@/lib/tradingview-bookmarklet"
import { PageHeader } from "@/components/page-header"
import { TradingViewPair } from "@/components/tradingview-pair"
import { LiveSyncUpgradeBanner } from "@/components/live-sync-upgrade-banner"
import { getT } from "@/lib/i18n/server"

// Pairs the TradeLoop browser extension with this journal. The page renders
// a pairing code where the extension's content script can read it, then
// waits for the extension to check in with that code.
export default async function ExtensionPairPage() {
  const t = await getT()
  const session = await auth.api.getSession({ headers: await headers() })
  if (!session?.user) redirect("/sign-in")

  const pro = await isPro(session.user.id)
  if (!pro) {
    return (
      <div>
        <PageHeader title={t("TradingView auto-sync")} description={t("Pair your browser once — every paper trade lands in your journal on its own.")} />
        <LiveSyncUpgradeBanner
          title={t("TradingView auto-sync")}
          description={t("Automatic sync from TradingView's paper account into the journal is included with Pro. Pasting your trades stays free.")}
        />
      </div>
    )
  }

  const pairing = await freshPairingFor(session.user.id)
  const bookmarklet = tradingviewBookmarklet(pairingBaseUrl(), pairing.token)
  return (
    <div>
      <PageHeader title={t("TradingView auto-sync")} description={t("Pair your browser once — every paper trade lands in your journal on its own.")} />
      <TradingViewPair
        pairingId={pairing.id}
        token={pairing.token}
        storeUrl={EXTENSION_STORE_URL}
        downloadPath={EXTENSION_DOWNLOAD_PATH}
        bookmarklet={bookmarklet}
      />
    </div>
  )
}
