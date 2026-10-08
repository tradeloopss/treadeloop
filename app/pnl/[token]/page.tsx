import type { Metadata } from "next"
import Link from "next/link"
import { headers } from "next/headers"
import { Lock, SearchX } from "lucide-react"
import { auth } from "@/lib/auth"
import { APP_URL, siteHref } from "@/lib/urls"
import { DESIGN_WORDS, sharePath } from "@/lib/pnl-cards/model"
import { readSharedCard } from "@/lib/pnl-cards/server"
import { BrandMark } from "@/components/brand-mark"
import { SharedPnlCard } from "@/components/pnl-cards/shared"

// A PNL card by its link (lib/pnl-cards). Open to anyone while its owner shares
// it, to its owner alone while it is private, and to nobody once it is deleted.
// Who may see it is decided on the server, and what the page is given has only
// what the owner left switched on.
//
// Nothing of a card goes into the page's title or description: those are read
// by every service a link is pasted into, whoever the card was meant for.
export const metadata: Metadata = { title: "PNL Card — TradeLoop", description: "A trading result shared from TradeLoop.", robots: { index: false, follow: false } }

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-svh flex-col items-center bg-gradient-to-br from-background via-background to-accent/30 px-4 py-10">
      <Link href={siteHref("/")} className="mb-8 flex items-center gap-2">
        <BrandMark className="size-9" />
        <span className="text-xl font-semibold tracking-tight">TradeLoop</span>
      </Link>
      {children}
    </div>
  )
}

function Notice({ icon: Icon, title, children }: { icon: typeof Lock; title: string; children: React.ReactNode }) {
  return (
    <div className="w-full max-w-md rounded-2xl border bg-card p-8 text-center">
      <span className="mx-auto flex size-12 items-center justify-center rounded-full bg-muted text-muted-foreground">
        <Icon className="size-5" aria-hidden />
      </span>
      <h1 className="mt-4 text-lg font-semibold tracking-tight">{title}</h1>
      <p className="mt-1.5 text-sm text-muted-foreground">{children}</p>
      <Link href={siteHref("/")} className="mt-5 inline-flex h-9 items-center justify-center rounded-lg border bg-background px-4 text-sm font-medium transition-colors hover:bg-muted">
        Go to TradeLoop
      </Link>
    </div>
  )
}

export default async function SharedPnlCardPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params
  const h = await headers()
  const session = await auth.api.getSession({ headers: h })
  const found = await readSharedCard(token, session?.user?.id ?? null)

  if (!found)
    return (
      <Shell>
        <Notice icon={SearchX} title="This PNL card isn't here">
          The link is wrong, or the card was deleted by the trader who made it.
        </Notice>
      </Shell>
    )
  if (found.state === "private")
    return (
      <Shell>
        <Notice icon={Lock} title="This PNL card is private">
          Only the trader who made it can open it. If it is yours, sign in to the account you made it with.
        </Notice>
      </Shell>
    )

  // where the card lives, for its QR code: the app's own address, or the one this request came to
  const base = APP_URL || `${h.get("x-forwarded-proto") ?? "https"}://${h.get("x-forwarded-host") ?? h.get("host") ?? ""}`
  return (
    <Shell>
      <p className="mb-4 text-center text-xs font-medium tracking-wide text-muted-foreground uppercase">{DESIGN_WORDS[found.card.design].shared}</p>
      <div className="w-full">
        <SharedPnlCard card={found.card} url={`${base}${sharePath(found.card.token)}`} />
      </div>
      {found.own && <p className="mt-5 max-w-md text-center text-xs text-muted-foreground">This is your {DESIGN_WORDS[found.card.design].noun}, as anyone you share it with sees it. What is switched off in the editor is not on it.</p>}
      <p className="mt-6 text-center text-xs text-muted-foreground">
        Made with{" "}
        <Link href={siteHref("/")} className="font-medium text-primary hover:underline">
          TradeLoop
        </Link>
        , the trading journal.
      </p>
    </Shell>
  )
}
