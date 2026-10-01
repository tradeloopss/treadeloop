import { and, eq, sql } from "drizzle-orm"
import { db } from "@/lib/db"
import { affiliates } from "@/lib/db/schema"
import { requireAdmin } from "@/lib/admin/guard"
import { roleCan } from "@/lib/admin/access"
import { FREQUENCY_LABELS } from "@/lib/affiliates/payout-engine"
import { getPayoutSettings, getProgram } from "@/lib/affiliates/program"
import { methodAvailable } from "@/lib/affiliates/providers"
import { exchangeStatus, payoutWalletStatus } from "@/lib/affiliates/admin-queries"
import { formatAsset } from "@/lib/affiliates/crypto"
import { money } from "@/lib/affiliates/types"
import { AdminPageHeader, Panel } from "@/components/admin/ui"
import { Kpi, KpiGrid, StatusBadge } from "@/components/affiliate/ui"
import { PausePanel, PayoutSettingsForm, RunAutoPayoutsButton } from "@/components/admin/affiliates/payout-admin"

export default async function AdminAffiliatePayoutSettingsPage() {
  const admin = await requireAdmin({ affiliates: ["view"] })
  const canManage = roleCan(admin.role, { affiliates: ["manage"] })
  const one = sql<number>`count(*)::int`
  const [settings, program, wallet, exchange, [optedIn], [disabled]] = await Promise.all([
    getPayoutSettings(),
    getProgram(),
    payoutWalletStatus(),
    exchangeStatus(),
    db.select({ v: one }).from(affiliates).where(and(eq(affiliates.status, "approved"), eq(affiliates.autoPayout, true), eq(affiliates.autoPayoutAllowed, true))),
    db.select({ v: one }).from(affiliates).where(and(eq(affiliates.status, "approved"), eq(affiliates.autoPayoutAllowed, false))),
  ])
  const running = settings.autoPayouts && !settings.paused
  // With an exchange account connected it sends every crypto payout; the payout wallet is the fallback for USDT on TRON.
  const exchangeSending = settings.cryptoAutoSend && exchange.ready && !settings.paused
  const sending = settings.cryptoAutoSend && wallet.ready && !exchange.ready && !settings.paused
  const anySending = exchangeSending || sending
  const relayIp = exchange.relay?.split(":")[0] ?? null
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
          <PayoutSettingsForm settings={settings} minPayout={program.minPayout} stripeReady={methodAvailable("stripe")} walletReady={wallet.ready} exchangeReady={exchange.ready} canManage={canManage} />
        </Panel>

        <Panel
          title="KuCoin account"
          description="Crypto payouts — USDT on TRON and Aptos, and Litecoin — are withdrawn from this exchange account through its API. No wallet key is kept on the server; the API key lives only in the server's environment."
          action={<StatusBadge status={exchangeSending ? "paid" : exchange.ready ? "pending" : "disabled"} label={exchangeSending ? "Sending automatically" : exchange.ready ? (settings.paused ? "Paused" : "Connected — automatic sending is off") : "Not connected"} className="normal-case" />}
        >
          {exchange.problem && <p className="mb-4 rounded-lg bg-[var(--chart-4)]/10 px-3 py-2 text-sm text-[var(--chart-4)]">{exchange.problem}</p>}
          {exchange.ready && !exchange.relay && <p className="mb-4 rounded-lg bg-[var(--chart-4)]/10 px-3 py-2 text-sm text-[var(--chart-4)]">KUCOIN_RELAY isn&apos;t set, so requests leave from changing addresses and KuCoin will refuse an API key that is restricted to a fixed IP.</p>}
          {exchange.ready ? (
            <div className="space-y-4">
              <div className="overflow-x-auto rounded-lg border">
                <table className="w-full min-w-[34rem] text-sm">
                  <thead className="bg-muted/40 text-xs text-muted-foreground">
                    <tr>
                      <th className="px-3 py-2 text-start font-medium">Payout method</th>
                      <th className="px-3 py-2 text-end font-medium">Available</th>
                      <th className="px-3 py-2 text-end font-medium">KuCoin&apos;s fee</th>
                      <th className="px-3 py-2 text-end font-medium">Smallest withdrawal</th>
                      <th className="px-3 py-2 text-end font-medium">Withdrawals</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y">
                    {exchange.networks.map((n) => (
                      <tr key={n.type}>
                        <td className="px-3 py-2">
                          <span className="font-medium">{n.asset}</span> <span className="text-muted-foreground">on {n.network}</span>
                        </td>
                        <td className="px-3 py-2 text-end tabular-nums">
                          {n.quota ? formatAsset(n.quota.available, n.asset, 6) : "—"}
                          {n.quota && n.priceUsd && n.priceUsd !== 1 ? <span className="block text-xs text-muted-foreground">about {money(n.quota.available * n.priceUsd)}</span> : null}
                        </td>
                        <td className="px-3 py-2 text-end tabular-nums">
                          {n.quota ? formatAsset(n.quota.fee, n.asset) : "—"}
                          {n.quota && n.priceUsd && n.quota.fee * n.priceUsd > settings.cryptoMaxFeeUsd ? <span className="block text-xs text-[var(--loss)]">above your {money(settings.cryptoMaxFeeUsd)} limit</span> : null}
                        </td>
                        <td className="px-3 py-2 text-end tabular-nums">{n.quota ? formatAsset(n.quota.min, n.asset) : "—"}</td>
                        <td className="px-3 py-2 text-end">{n.quota ? n.quota.enabled ? "Open" : <span className="text-[var(--loss)]">Closed by KuCoin</span> : "—"}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <KpiGrid>
                <Kpi label="Sent automatically today" value={money(wallet.sentToday)} note={`${wallet.sentTodayCount} payout${wallet.sentTodayCount === 1 ? "" : "s"} · limit ${money(settings.cryptoAutoDaily)}`} />
                <Kpi label="Waiting on the account" value={money(exchange.waiting)} note={`${exchange.waitingCount} payout${exchange.waitingCount === 1 ? "" : "s"} queued or needing a retry`} />
              </KpiGrid>
              <p className="text-xs text-muted-foreground">
                Withdrawals come out of the account&apos;s <span className="font-medium text-foreground">Funding</span> balance, and KuCoin&apos;s fee is paid on top, so the affiliate receives the full amount. Keep a working float there — a few days of payouts — not your reserves. Litecoin payouts need LTC in the account: they are converted from US dollars at the market price when sent.
              </p>
            </div>
          ) : (
            <div className="space-y-2 text-sm text-muted-foreground">
              <p>To connect it:</p>
              <ol className="list-decimal space-y-1.5 ps-5">
                <li>
                  In KuCoin, create an API key with the <span className="font-medium text-foreground">General</span> and <span className="font-medium text-foreground">Withdrawal</span> permissions only — no trading.
                </li>
                <li>
                  Restrict the key to this IP address: <span className="font-mono text-xs text-foreground">{relayIp ?? "the sync server's address (KUCOIN_RELAY)"}</span>. KuCoin requires a fixed IP for withdrawals.
                </li>
                <li>
                  Set <span className="font-mono text-xs">KUCOIN_API_KEY</span>, <span className="font-mono text-xs">KUCOIN_API_SECRET</span> and <span className="font-mono text-xs">KUCOIN_API_PASSPHRASE</span> in the server environment (mark them Sensitive), then redeploy.
                </li>
                <li>Move the payout float into the account&apos;s Funding balance: USDT for the USDT payouts and their fees, LTC for Litecoin.</li>
              </ol>
            </div>
          )}
        </Panel>

        <Panel
          title="Payout wallet"
          description={exchange.ready ? "Not in use while the KuCoin account is connected. Without it, USDT (TRC-20) payouts can be sent from this wallet instead." : "The wallet automatic USDT (TRC-20) payouts are sent from when no exchange account is connected. Its key lives only in the server's environment — never in the database, the logs or this page."}
          action={<StatusBadge status={sending ? "paid" : wallet.ready ? "pending" : "disabled"} label={sending ? "Sending automatically" : wallet.ready ? (exchange.ready ? "Standby" : settings.paused ? "Paused" : "Ready — sending is off") : "Not configured"} className="normal-case" />}
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
              <span className="font-medium text-foreground">USDT (TRC-20)</span> is sent {anySending ? `automatically from ${exchangeSending ? "the KuCoin account" : "the payout wallet"} when the request is inside the limits; otherwise` : ""} {exchange.ready ? "by the KuCoin account once you approve it, or" : ""} by hand from your own wallet: you paste the transaction hash. Either way the payout completes only when the TRON network confirms a USDT transfer of the payout amount to the affiliate&apos;s wallet — never on the server&apos;s say-so.
            </li>
            <li>
              <span className="font-medium text-foreground">USDT (Aptos) and Litecoin</span> are sent only by the KuCoin account: automatically inside the limits, otherwise the moment you approve the payout. They complete when KuCoin reports the withdrawal as sent. A Litecoin payout is converted from US dollars at the market price when it is sent.
            </li>
            <li>
              <span className="font-medium text-foreground">An automatic transfer is never sent twice.</span> Each attempt is recorded before anything is sent, and a new one is made only after it is proven the earlier one can no longer go through.
            </li>
            <li>
              <span className="font-medium text-foreground">Stripe Connect</span> is sent automatically by API once it&apos;s configured.
            </li>
            <li>
              <span className="font-medium text-foreground">Automatic payouts</span> create and reserve the payout on schedule for affiliates who opted in. With the methods sent by hand, they then wait in the queue for you; they do not move money on their own.{anySending ? " Crypto payouts inside the limits are the exception: they are sent straight away." : ""}
            </li>
            <li>
              <span className="font-medium text-foreground">The worker runs every two minutes</span> from the sync server (it calls <span className="font-mono text-xs">/api/cron/affiliate-payouts</span> with the cron secret), once a day as a fallback, and whenever you press Run now. Each run confirms transfers, sends the crypto payouts that are queued, and creates the automatic payouts that are due. A second run in the same period never creates a second payout.
            </li>
          </ul>
        </Panel>
      </div>
    </div>
  )
}
