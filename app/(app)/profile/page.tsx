import { redirect } from "next/navigation"
import { headers } from "next/headers"
import { auth } from "@/lib/auth"
import { getTrades } from "@/app/actions/trades"
import { analyze } from "@/lib/calc"
import { PageHeader } from "@/components/page-header"
import { ProfileForm } from "@/components/profile-form"
import { Card } from "@/components/ui/card"

export default async function ProfilePage() {
  const session = await auth.api.getSession({ headers: await headers() })
  if (!session?.user) redirect("/sign-in")

  const rows = await getTrades()
  const a = analyze(
    rows.map((t) => ({
      pnl: Number(t.pnl),
      entryTime: t.entryTime,
      exitTime: t.exitTime,
      rMultiple: t.rMultiple == null ? null : Number(t.rMultiple),
      status: t.status,
    })),
  )
  const memberSince = new Date(session.user.createdAt).toLocaleDateString("en-US", {
    month: "long",
    year: "numeric",
  })

  return (
    <div>
      <PageHeader title="Profile" description="Your account details and trading stats" />
      <div className="space-y-6 p-4 sm:p-6">
        <div className="grid gap-4 sm:grid-cols-3">
          <Card className="p-4">
            <p className="text-xs text-muted-foreground">Member since</p>
            <p className="mt-1 font-semibold">{memberSince}</p>
          </Card>
          <Card className="p-4">
            <p className="text-xs text-muted-foreground">Trades logged</p>
            <p className="mt-1 font-semibold tabular-nums">{a.totalTrades}</p>
          </Card>
          <Card className="p-4">
            <p className="text-xs text-muted-foreground">Win rate</p>
            <p className="mt-1 font-semibold tabular-nums">{a.winRate.toFixed(1)}%</p>
          </Card>
        </div>

        <ProfileForm name={session.user.name} email={session.user.email} image={session.user.image ?? null} />
      </div>
    </div>
  )
}
