import { redirect } from "next/navigation"
import { headers } from "next/headers"
import { and, count, eq } from "drizzle-orm"
import { auth } from "@/lib/auth"
import { db } from "@/lib/db"
import { trades, backtestSessions, journalEntries, securityEvents } from "@/lib/db/schema"
import { getUserSettings } from "@/app/actions/settings"
import { computeProfileStats, ymd } from "@/lib/settings/profile-stats"
import { ProfileView } from "@/components/settings/pages/profile-view"

export const metadata = { title: "Profile" }

export default async function ProfileSettingsPage() {
  const session = await auth.api.getSession({ headers: await headers() })
  if (!session?.user) redirect("/sign-in")
  const userId = session.user.id

  const [settings, tradeRows, loginRows, btCount, jCount] = await Promise.all([
    getUserSettings(),
    db.select({ entryTime: trades.entryTime }).from(trades).where(eq(trades.userId, userId)),
    db
      .select({ createdAt: securityEvents.createdAt })
      .from(securityEvents)
      .where(and(eq(securityEvents.userId, userId), eq(securityEvents.type, "sign_in"))),
    db.select({ n: count() }).from(backtestSessions).where(eq(backtestSessions.userId, userId)),
    db.select({ n: count() }).from(journalEntries).where(eq(journalEntries.userId, userId)),
  ])

  const stats = computeProfileStats({
    tradeDays: tradeRows.map((r) => ymd(r.entryTime)),
    loginDays: loginRows.map((r) => ymd(r.createdAt)),
    backtested: btCount[0]?.n ?? 0,
    journalEntries: jCount[0]?.n ?? 0,
    entries: tradeRows.length,
    todayYmd: ymd(new Date()),
  })

  const handle = settings.username ?? session.user.email.split("@")[0].replace(/[^a-z0-9._-]/gi, "").toLowerCase()

  return (
    <ProfileView
      user={{ name: session.user.name, email: session.user.email, image: session.user.image ?? null, createdAt: new Date(session.user.createdAt).toISOString() }}
      handle={handle}
      initial={{ bio: settings.bio, tradingStrategy: settings.tradingStrategy, yearsTrading: settings.yearsTrading, social: settings.social }}
      stats={stats}
    />
  )
}
