import { requireFeature } from "@/lib/features/server"
import { insightPage, type PageContext, type SearchParams } from "@/lib/edge/page"
import { localDay } from "@/lib/timezone"
import { dayCheckins, linkCheckins, type DayRow } from "./server"

// What every Psychology page starts from: the trades, and what the trader has
// said about their days. Check-ins still waiting for their trade are attached
// first, so the page shows them.
export type PsychContext = PageContext & { today: string; checkins: DayRow[] }

export async function psychPage(searchParams: SearchParams): Promise<PsychContext> {
  const { userId } = await requireFeature("psychology")
  await linkCheckins(userId).catch(() => 0)
  const ctx = await insightPage("psychology", searchParams)
  const today = localDay(new Date(), ctx.timeZone)
  const checkins = await dayCheckins(userId, localDay(Date.now() - 120 * 86_400_000, ctx.timeZone))
  return { ...ctx, today, checkins }
}
