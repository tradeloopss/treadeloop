import { and, eq, sql } from "drizzle-orm"
import { db } from "@/lib/db"
import { affiliates } from "@/lib/db/schema"
import { requireAdmin } from "@/lib/admin/guard"
import { roleCan } from "@/lib/admin/access"
import { FREQUENCY_LABELS } from "@/lib/affiliates/payout-engine"
import { getPayoutSettings, getProgram } from "@/lib/affiliates/program"
import { methodAvailable } from "@/lib/affiliates/providers"
import { payoutWalletStatus } from "@/lib/affiliates/admin-queries"
import { money } from "@/lib/affiliates/types"
import { AdminPageHeader, Panel } from "@/components/admin/ui"
import { Kpi, KpiGrid, StatusBadge } from "@/components/affiliate/ui"
import { PausePanel, PayoutSettingsForm, RunAutoPayoutsButton } from "@/components/admin/affiliates/payout-admin"

export default async function AdminAffiliatePayoutSettingsPage() {
  const admin = await requireAdmin({ affiliates: ["view"] })
  const canManage = roleCan(admin.role, { affiliates: ["manage"] })
  const one = sql<number>`count(*)::int`
  const [settings, program, wallet, [optedIn], [disabled]] = await Promise.all([
    getPayoutSettings(),
    getProgram(),
    payoutWalletStatus(),
    db.select({ v: one }).from(affiliates).where(and(eq(affiliates.status, "approved"), eq(affiliates.autoPayout, true), eq(affiliates.autoPayoutAllowed, true))),
    db.select({ v: one }).from(affiliates).where(and(eq(affiliates.status, "approved"), eq(affiliates.autoPayoutAllowed, false))),
  ])
  const running = settings.autoPayouts && !settings.paused
  const sending = settings.cryptoAutoSend && wallet.ready && !settings.paused
  const trx = wallet.balances ? wallet.balances.trxSun / 1_000_000 : null
  // Roughly what one USDT transfer burns when the wallet has no staked energy.
  const lowTrx = trx != null && wallet.balances!.energyAvailable < 65_000 && trx < 30
  const lowUsdt = wallet.balances != null && wallet.waiting > wallet.balances.usdt

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
          <PayoutSettingsForm settings={settings} minPayout={program.minPayout} stripeReady={methodAvailable("stripe")} walletReady={wallet.ready} canManage={canManage} />
        </Panel>

        <Panel
          title="Payout wallet"
          description="The wallet automatic USDT payouts are sent from. Its key lives only in the server's environment — never in the database, the logs or this page."
          action={<StatusBadge status={sending ? "paid" : wallet.ready ? "pending" : "disabled"} label={sending ? "Sending automatically" : wallet.ready ? (settings.paused ? "Paused" : "Ready — sending is off") : "Not configured"} className="normal-case" />}
        >
          {!wallet.ready && <p className="mb-4 rounded-lg bg-[var(--chart-4)]/10 px-3 py-2 text-sm text-[var(--chart-4)]">{wallet.problem}</p>}
          {wallet.address ? (
            <div className="space-y-4">
              <div>
                <p className="text-xs text-muted-foreground">Address (TRON) — fund this address with USDT TRC-20, and TRX for network fees</p>
                <p className="mt-1 break-all font-mono text-sm">{wallet.address}</p>
              </div>
              <KpiGrid>
                <Kpi label="USDT in the wallet" value={wallet.balances ? wallet.balances.usdt.toFixed(2) : "—"} note={wallet.balances ? (lowUsdt ? <span className="text-[var(--loss)]">Less than the {money(wallet.waiting)} waiting to be sent</span> : "Available to send") : "Couldn't reach the TRON network"} />
                <Kpi label="TRX for fees" value={trx != null ? trx.toFixed(1) : "—"} note={trx != null ? (lowTrx ? <span className="text-[var(--loss)]">Low — a transfer burns about 14–28 TRX</span> : wallet.balances!.energyAvailable > 0 ? `${wallet.balances!.energyAvailable.toLocaleString("en-US")} staked energy available` : "A transfer burns about 14–28 TRX") : ""} />
                <Kpi label="Sent automatically today" value={money(wallet.sentToday)} note={`${wallet.sentTodayCount} payout${wallet.sentTodayCount === 1 ? "" : "s"} · limit ${money(settings.cryptoAutoDaily)}`} />
                <Kpi label="Waiting on the wallet" value={money(wallet.waiting)} note={`${wallet.waitingCount} payout${wallet.waitingCount === 1 ? "" : "s"} queued or needing a retry`} />
              </KpiGrid>
              <p className="text-xs text-muted-foreground">
                This is a hot wallet: keep a working float in it — a few days of payouts — not your reserves, and top it up as it runs down. Every transfer is checked against the limits above before it is signed, and a payout is only completed when the TRON network confirms the transfer.
              </p>
            </div>
          ) : (
            <p className="text-sm text-muted-foreground">
              To send USDT automatically, create a new TRON wallet used for nothing else, set its private key as <span className="font-mono text-xs">TRON_PAYOUT_PRIVATE_KEY</span> and its address as <span className="font-mono text-xs">TRON_PAYOUT_ADDRESS</span> in the server environment, then redeploy. Until then USDT payouts are sent by hand.
            </p>
          )}
        </Panel>

        <Panel title="How a payout is sent">
          <ul className="space-y-2 text-sm text-muted-foreground">
            <li>
              <span className="font-medium text-foreground">PayPal, Wise and bank transfer</span> are sent by hand: open the payout, see the account, send the money, then mark it paid.
            </li>
            <li>
              <span className="font-medium text-foreground">USDT (TRC-20)</span> is sent {sending ? "automatically from the payout wallet when the request is inside the limits; otherwise" : ""} by hand from your own wallet: you paste the transaction hash. Either way the payout completes only when the TRON network confirms a USDT transfer of the payout amount to the affiliate&apos;s wallet — never on the server&apos;s say-so.
            </li>
            <li>
              <span className="font-medium text-foreground">An automatic transfer is never sent twice.</span> The signed transaction is recorded before it is broadcast, and a new one is signed only after the network proves the earlier one expired without being included.
            </li>
            <li>
              <span className="font-medium text-foreground">Stripe Connect</span> is sent automatically by API once it&apos;s configured.
            </li>
            <li>
              <span className="font-medium text-foreground">Automatic payouts</span> create and reserve the payout on schedule for affiliates who opted in. With the methods sent by hand, they then wait in the queue for you; they do not move money on their own.{sending ? " USDT payouts inside the limits are the exception: they are sent from the payout wallet." : ""}
            </li>
            <li>
              <span className="font-medium text-foreground">The worker runs every two minutes</span> from the sync server (it calls <span className="font-mono text-xs">/api/cron/affiliate-payouts</span> with the cron secret), once a day as a fallback, and whenever you press Run now. Each run confirms transfers on the network, sends what is queued for the payout wallet, and creates the automatic payouts that are due. A second run in the same period never creates a second payout.
            </li>
          </ul>
        </Panel>
      </div>
    </div>
  )
}
