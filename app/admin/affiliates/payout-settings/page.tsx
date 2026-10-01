import { and, eq, sql } from "drizzle-orm"
import { db } from "@/lib/db"
import { affiliates } from "@/lib/db/schema"
import { requireAdmin } from "@/lib/admin/guard"
import { roleCan } from "@/lib/admin/access"
import { FREQUENCY_LABELS } from "@/lib/affiliates/payout-engine"
import { getPayoutSettings, getProgram } from "@/lib/affiliates/program"
import { methodAvailable } from "@/lib/affiliates/providers"
import { money } from "@/lib/affiliates/types"
import { AdminPageHeader, Panel } from "@/components/admin/ui"
import { Kpi, KpiGrid } from "@/components/affiliate/ui"
import { PausePanel, PayoutSettingsForm, RunAutoPayoutsButton } from "@/components/admin/affiliates/payout-admin"

export default async function AdminAffiliatePayoutSettingsPage() {
  const admin = await requireAdmin({ affiliates: ["view"] })
  const canManage = roleCan(admin.role, { affiliates: ["manage"] })
  const one = sql<number>`count(*)::int`
  const [settings, program, [optedIn], [disabled]] = await Promise.all([
    getPayoutSettings(),
    getProgram(),
    db.select({ v: one }).from(affiliates).where(and(eq(affiliates.status, "approved"), eq(affiliates.autoPayout, true), eq(affiliates.autoPayoutAllowed, true))),
    db.select({ v: one }).from(affiliates).where(and(eq(affiliates.status, "approved"), eq(affiliates.autoPayoutAllowed, false))),
  ])
  const running = settings.autoPayouts && !settings.paused

  return (
    <div>
      <AdminPageHeader title="Payout settings" description="How and when affiliates are paid. Every switch here is enforced on the server at the moment a payout would be created." />
      <div className="flex flex-col gap-4 p-4 sm:p-6">
        <PausePanel paused={settings.paused} canManage={canManage} />

        <KpiGrid>
          <Kpi label="Automatic payouts" value={settings.paused ? "Paused" : settings.autoPayouts ? "ON" : "OFF"} note={settings.autoPayouts ? `${FREQUENCY_LABELS[settings.frequency]}` : "No automatic payout is created"} />
          <Kpi label="Mode" value={settings.approval === "manual" ? "Manual approval" : "Automatic"} note={settings.approval === "manual" ? "Each payout waits for an admin" : "Payouts go straight to the queue"} />
          <Kpi label="Limits" value={`${money(program.minPayout)} – ${settings.maxPayout == null ? "no max" : money(settings.maxPayout)}`} note={settings.dailyLimit == null ? "No daily limit" : `${money(settings.dailyLimit)} a day, program-wide`} />
          <Kpi label="Affiliates opted in" value={String(optedIn?.v ?? 0)} note={`${disabled?.v ?? 0} disabled by an admin`} />
        </KpiGrid>

        <Panel
          title="Global payout settings"
          description="These apply to every affiliate, unless an affiliate has a custom minimum or maximum on their own page."
          action={canManage ? <RunAutoPayoutsButton disabled={!running} /> : undefined}
        >
          <PayoutSettingsForm settings={settings} minPayout={program.minPayout} stripeReady={methodAvailable("stripe")} canManage={canManage} />
        </Panel>

        <Panel title="How a payout is sent">
          <ul className="space-y-2 text-sm text-muted-foreground">
            <li>
              <span className="font-medium text-foreground">PayPal, Wise and bank transfer</span> are sent by hand: open the payout, see the account, send the money, then mark it paid.
            </li>
            <li>
              <span className="font-medium text-foreground">USDT (TRC-20)</span> is sent by hand from your own wallet — this app never holds a private key. You paste the transaction hash, and the payout completes only when the TRON network confirms a USDT transfer of at least the payout amount to the affiliate&apos;s wallet.
            </li>
            <li>
              <span className="font-medium text-foreground">Stripe Connect</span> is sent automatically by API once it&apos;s configured.
            </li>
            <li>
              <span className="font-medium text-foreground">Automatic payouts</span> create and reserve the payout on schedule for affiliates who opted in. With the methods sent by hand, they then wait in the queue for you; they do not move money on their own.
            </li>
            <li>
              <span className="font-medium text-foreground">The worker runs once a day</span>, and whenever you press Run now. To run it more often — for the &quot;as soon as the threshold is reached&quot; frequency, or faster crypto confirmations — have your scheduler call <span className="font-mono text-xs">/api/cron/affiliate-payouts</span> with the cron secret. A second run in the same period never creates a second payout.
            </li>
          </ul>
        </Panel>
      </div>
    </div>
  )
}
