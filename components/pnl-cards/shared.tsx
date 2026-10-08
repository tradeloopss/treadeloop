"use client"

import { FitToWidth } from "@/components/fit-to-width"
import type { PublicPnlCard } from "@/lib/pnl-cards/model"
import { PnlCard, cardWidth } from "./card"

// A PNL card as its link shows it: the same renderer as the editor's preview and
// the downloaded image, given the card the server has already taken everything
// hidden out of.
export function SharedPnlCard({ card, url }: { card: PublicPnlCard; url: string }) {
  return (
    <FitToWidth width={cardWidth(card.design, card.layout)} className={card.layout === "mobile" ? "mx-auto max-w-[26rem]" : "mx-auto max-w-[50rem]"}>
      <PnlCard design={card.design} data={card.data} layout={card.layout} visibility={card.visibility} shareUrl={url} />
    </FitToWidth>
  )
}
