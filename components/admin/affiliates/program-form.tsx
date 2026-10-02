"use client"

import { useState } from "react"
import { Trash2 } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { deleteRule, deleteTier, saveProgramSettings, saveRule, saveTier, setRuleEnabled } from "@/app/actions/admin-affiliates"
import { TIER_PERKS, TIER_STYLES, tierRateText, type TierPerk, type TierPerks, type TierStyle } from "@/lib/affiliates/engine"
import type { ProgramSettings } from "@/lib/affiliates/types"
import { ConfirmButton } from "@/components/affiliate/confirm"
import { Empty, StatusBadge, TableShell, THead, fmtDay, selectClass, tdClass, thClass } from "@/components/affiliate/ui"
import { useAction } from "@/components/affiliate/use-action"

const label = "flex flex-col gap-1.5 text-xs text-muted-foreground"

// --- Program settings -----------------------------------------------------------

export function ProgramForm({ program, canManage }: { program: ProgramSettings; canManage: boolean }) {
  const [form, setForm] = useState({ ...program, durationMonths: program.durationMonths == null ? "" : String(program.durationMonths) })
  const { pending, run } = useAction()
  const num = (k: "defaultRate" | "cookieDays" | "minPayout" | "holdDays" | "maxCouponPercent" | "permanentCouponPercent" | "permanentCouponMonths") => (e: React.ChangeEvent<HTMLInputElement>) => setForm((f) => ({ ...f, [k]: e.target.value as unknown as number }))
  const toggle = (k: "refundReversal" | "autoApprove" | "couponsEnabled") => (e: React.ChangeEvent<HTMLInputElement>) => setForm((f) => ({ ...f, [k]: e.target.checked }))

  return (
    <form
      className="grid gap-5"
      onSubmit={(e) => {
        e.preventDefault()
        run(() => saveProgramSettings({ ...form, durationMonths: form.durationMonths === "" ? null : Number(form.durationMonths) }))
      }}
    >
      <fieldset disabled={!canManage || pending} className="grid gap-5">
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <label className={label}>
            Default commission (%)
            <Input type="number" min={0} max={90} step="0.5" value={form.defaultRate} onChange={num("defaultRate")} required />
            <span>Used when no rule or tier applies.</span>
          </label>
          <label className={label}>
            Commission type
            <select value={form.commissionType} onChange={(e) => setForm((f) => ({ ...f, commissionType: e.target.value as ProgramSettings["commissionType"] }))} className={selectClass}>
              <option value="recurring">Recurring — every payment</option>
              <option value="one_time">One-time — first payment only</option>
            </select>
          </label>
          <label className={label}>
            Earning window (months)
            <Input type="number" min={1} max={240} step={1} value={form.durationMonths} onChange={(e) => setForm((f) => ({ ...f, durationMonths: e.target.value }))} placeholder="Lifetime" disabled={form.commissionType === "one_time"} />
            <span>Empty = for as long as the customer pays.</span>
          </label>
          <label className={label}>
            Attribution
            <select value={form.attribution} onChange={(e) => setForm((f) => ({ ...f, attribution: e.target.value as ProgramSettings["attribution"] }))} className={selectClass}>
              <option value="first_touch">First click wins</option>
              <option value="last_touch">Last click wins</option>
            </select>
          </label>
          <label className={label}>
            Tracking window (days)
            <Input type="number" min={1} max={365} step={1} value={form.cookieDays} onChange={num("cookieDays")} required />
          </label>
          <label className={label}>
            Holding period (days)
            <Input type="number" min={0} max={180} step={1} value={form.holdDays} onChange={num("holdDays")} required />
            <span>Match your refund window. Shortening it also brings forward commissions still pending; lengthening it only affects new payments.</span>
          </label>
          <label className={label}>
            Minimum payout (USD)
            <Input type="number" min={1} step="1" value={form.minPayout} onChange={num("minPayout")} required />
          </label>
          <label className={label}>
            Payout timing shown to affiliates
            <Input value={form.payoutEta} onChange={(e) => setForm((f) => ({ ...f, payoutEta: e.target.value }))} maxLength={60} required />
          </label>
        </div>

        <ul className="divide-y rounded-lg border">
          {(
            [
              ["refundReversal", "Reverse commissions on refunds", "A refunded payment takes its commission back (proportionally for a partial refund). Chargebacks always reverse."],
              ["autoApprove", "Auto-approve applications", "Off = every application waits for a person to approve it."],
              ["couponsEnabled", "Let affiliates create coupons", "Only for affiliates whose Coupons section you have opened on their page. Each coupon is a real promo code at checkout."],
            ] as const
          ).map(([key, title, body]) => (
            <li key={key}>
              <label className="flex cursor-pointer items-center justify-between gap-4 px-3 py-2.5">
                <span>
                  <span className="block text-sm font-medium text-foreground">{title}</span>
                  <span className="block text-xs text-muted-foreground">{body}</span>
                </span>
                <input type="checkbox" role="switch" checked={form[key]} onChange={toggle(key)} className="size-4 shrink-0 accent-[var(--primary)]" />
              </label>
            </li>
          ))}
        </ul>
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <label className={label}>
            Permanent code discount (%)
            <Input type="number" min={0} max={100} step={1} value={form.permanentCouponPercent} onChange={num("permanentCouponPercent")} required />
            <span>Every affiliate gets one permanent code with this discount. 0 = no permanent codes.</span>
          </label>
          <label className={label}>
            Permanent code applies to the first
            <select value={form.permanentCouponMonths} onChange={(e) => setForm((f) => ({ ...f, permanentCouponMonths: Number(e.target.value) }))} className={selectClass}>
              {[1, 2, 3, 6, 12].map((m) => (
                <option key={m} value={m}>
                  {m === 1 ? "month" : `${m} months`}
                </option>
              ))}
            </select>
            <span>Codes already created keep theirs until you update them on the affiliate&apos;s page.</span>
          </label>
          {form.couponsEnabled && (
            <label className={label}>
              Largest coupon discount (%)
              <Input type="number" min={1} max={100} step={1} value={form.maxCouponPercent} onChange={num("maxCouponPercent")} required />
              <span>For coupons affiliates create themselves. An affiliate can have their own limit.</span>
            </label>
          )}
        </div>
      </fieldset>
      {canManage && (
        <div className="flex items-center gap-3">
          <Button type="submit" disabled={pending}>
            {pending ? "Saving…" : "Save program rules"}
          </Button>
          <p className="text-xs text-muted-foreground">Changes apply to payments from now on. Commissions already recorded keep the rate they were created with.</p>
        </div>
      )}
    </form>
  )
}

// --- Tiers ------------------------------------------------------------------------

export type TierView = { id: number; name: string; minCustomers: number; ratePercent: number; introMonths?: number | null; afterPercent?: number | null; perks?: TierPerks; tagline?: string | null; style?: TierStyle; enabled: boolean; affiliates: number }

const PERK_NAMES: Record<TierPerk, [string, string]> = {
  coupon: ["Personal coupon code", "Their own discount code, created when they reach the tier."],
  beta: ["Beta feature access", "Features that aren't released to everyone yet."],
  freeAccount: ["Free-forever account", "A Pro plan with no end date, granted once."],
  prioritySupport: ["Priority support", "Their tickets and feature requests are answered first."],
}

function TierEditor({ tier, canManage }: { tier: TierView | null; canManage: boolean }) {
  const blank = { name: "", minCustomers: "", ratePercent: "", introMonths: "", afterPercent: "", tagline: "", style: "plain" as TierStyle, perks: {} as TierPerks, enabled: true }
  const [form, setForm] = useState(tier ? { name: tier.name, minCustomers: String(tier.minCustomers), ratePercent: String(tier.ratePercent), introMonths: tier.introMonths == null ? "" : String(tier.introMonths), afterPercent: tier.afterPercent == null ? "" : String(tier.afterPercent), tagline: tier.tagline ?? "", style: tier.style ?? "plain", perks: tier.perks ?? {}, enabled: tier.enabled } : blank)
  const { pending, run } = useAction()
  const set = <K extends keyof typeof form>(k: K, v: (typeof form)[K]) => setForm((f) => ({ ...f, [k]: v }))
  const scheduled = form.introMonths !== ""
  // What the tier will pay, in words, as it is typed.
  const pays = form.ratePercent === "" ? "" : tierRateText({ ratePercent: Number(form.ratePercent), introMonths: scheduled ? Number(form.introMonths) : null, afterPercent: form.afterPercent === "" ? null : Number(form.afterPercent) })

  return (
    <li className="rounded-xl border bg-card p-4">
      <fieldset disabled={!canManage || pending} className="grid gap-4">
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-6">
          <label className={`${label} lg:col-span-2`}>
            Tier name
            <Input value={form.name} onChange={(e) => set("name", e.target.value)} maxLength={40} placeholder="New tier name" />
          </label>
          <label className={label}>
            Paying customers needed
            <Input type="number" min={0} step={1} value={form.minCustomers} onChange={(e) => set("minCustomers", e.target.value)} />
          </label>
          <label className={label}>
            Commission (%)
            <Input type="number" min={0.5} max={90} step="0.5" value={form.ratePercent} onChange={(e) => set("ratePercent", e.target.value)} />
          </label>
          <label className={label}>
            For the first (months)
            <Input type="number" min={1} max={120} step={1} value={form.introMonths} onChange={(e) => set("introMonths", e.target.value)} placeholder="Always" />
          </label>
          <label className={label}>
            Then (%)
            <Input type="number" min={0.5} max={90} step="0.5" value={form.afterPercent} onChange={(e) => set("afterPercent", e.target.value)} placeholder={scheduled ? "Stops" : "—"} disabled={!scheduled} />
          </label>
        </div>
        <p className="-mt-2 text-xs text-muted-foreground">
          {pays ? (
            <>
              Pays <span className="font-medium text-foreground">{pays}</span>
              {scheduled ? (form.afterPercent === "" ? " — counted from each customer's first payment; after that the customer stops earning." : " for as long as the customer stays subscribed — counted from each customer's first payment.") : " on every payment that earns a commission."}
            </>
          ) : (
            "Leave the months empty for one rate throughout."
          )}
        </p>

        <div>
          <p className="text-xs text-muted-foreground">What reaching it unlocks</p>
          <div className="mt-1.5 grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
            {TIER_PERKS.map((k) => (
              <label key={k} className="flex cursor-pointer items-start gap-2 rounded-lg border px-3 py-2">
                <input type="checkbox" checked={form.perks[k] === true} onChange={(e) => set("perks", { ...form.perks, [k]: e.target.checked })} className="mt-0.5 size-4 shrink-0 accent-[var(--primary)]" />
                <span>
                  <span className="block text-sm font-medium text-foreground">{PERK_NAMES[k][0]}</span>
                  <span className="block text-xs text-muted-foreground">{PERK_NAMES[k][1]}</span>
                </span>
              </label>
            ))}
          </div>
        </div>

        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-6">
          <label className={`${label} lg:col-span-3`}>
            Line on the card (optional)
            <Input value={form.tagline} onChange={(e) => set("tagline", e.target.value)} maxLength={120} placeholder="e.g. Start your journey. Earn from your first referral!" />
          </label>
          <label className={label}>
            Card style
            <select value={form.style} onChange={(e) => set("style", e.target.value as TierStyle)} className={selectClass}>
              {TIER_STYLES.map((s) => (
                <option key={s} value={s}>
                  {s[0].toUpperCase() + s.slice(1)}
                </option>
              ))}
            </select>
          </label>
          <label className="flex cursor-pointer items-center gap-2 self-end pb-2 text-sm">
            <input type="checkbox" role="switch" checked={form.enabled} onChange={(e) => set("enabled", e.target.checked)} className="size-4 accent-[var(--primary)]" />
            Enabled
          </label>
          <p className="self-end pb-2 text-xs text-muted-foreground lg:text-end">{tier ? `${tier.affiliates} affiliate${tier.affiliates === 1 ? "" : "s"} in it` : "New tier"}</p>
        </div>
      </fieldset>

      {canManage && (
        <div className="mt-4 flex justify-end gap-1.5 border-t pt-3">
          {tier && (
            <ConfirmButton variant="ghost" destructive title={`Delete the ${tier.name} tier?`} description="Affiliates in it fall back to whichever remaining tier they qualify for (or the default rate). Commissions already recorded don't change, and nothing a tier already unlocked is taken back." confirmLabel="Delete" action={() => deleteTier(tier.id)}>
              <Trash2 className="size-3.5" aria-hidden /> Delete
            </ConfirmButton>
          )}
          <Button
            variant={tier ? "outline" : "default"}
            size="sm"
            disabled={pending || !form.name.trim() || form.minCustomers === "" || form.ratePercent === ""}
            onClick={() =>
              run(
                () =>
                  saveTier({
                    id: tier?.id ?? null,
                    name: form.name,
                    minCustomers: Number(form.minCustomers),
                    ratePercent: Number(form.ratePercent),
                    introMonths: form.introMonths === "" ? null : Number(form.introMonths),
                    afterPercent: !scheduled || form.afterPercent === "" ? null : Number(form.afterPercent),
                    perks: form.perks,
                    tagline: form.tagline,
                    style: form.style,
                    enabled: form.enabled,
                  }),
                () => {
                  if (!tier) setForm(blank)
                }
              )
            }
          >
            {tier ? "Save" : "Add tier"}
          </Button>
        </div>
      )}
    </li>
  )
}

export function TiersEditor({ tiers, canManage }: { tiers: TierView[]; canManage: boolean }) {
  return (
    <ul className="grid gap-3">
      {tiers.map((t) => (
        <TierEditor key={t.id} tier={t} canManage={canManage} />
      ))}
      {canManage && <TierEditor key="new" tier={null} canManage />}
    </ul>
  )
}

// --- Custom rules -----------------------------------------------------------------

export type RuleView = { id: number; scope: string; affiliateId: number; affiliate: string; target: string | null; ratePercent: number; durationMonths: number | null; startsAt: string | null; endsAt: string | null; enabled: boolean; note: string | null }

export function RulesTable({ rules, canManage, showAffiliate = true }: { rules: RuleView[]; canManage: boolean; showAffiliate?: boolean }) {
  const { pending, run } = useAction()
  if (rules.length === 0) {
    return (
      <div className="rounded-xl border bg-card">
        <Empty title="No custom rules">Everyone earns by their tier, or the program default. Add a rule from an affiliate&apos;s page to give them, one of their campaigns or one of their coupons a different rate.</Empty>
      </div>
    )
  }
  const live = (r: RuleView) => r.enabled && (!r.startsAt || new Date(r.startsAt) <= new Date()) && (!r.endsAt || new Date(r.endsAt) > new Date())
  return (
    <TableShell>
      <THead>
        <tr>
          {showAffiliate && <th className={thClass}>Affiliate</th>}
          <th className={thClass}>Applies to</th>
          <th className={thClass}>Rate</th>
          <th className={thClass}>Earning window</th>
          <th className={thClass}>Active</th>
          <th className={thClass}>Status</th>
          <th className={`${thClass} text-end`}>Actions</th>
        </tr>
      </THead>
      <tbody className="divide-y">
        {rules.map((r) => (
          <tr key={r.id}>
            {showAffiliate && (
              <td className={tdClass}>
                <a href={`/admin/affiliates/${r.affiliateId}`} className="font-medium hover:underline">
                  {r.affiliate}
                </a>
              </td>
            )}
            <td className={tdClass}>
              {r.scope === "affiliate" ? "Everything they refer" : r.scope === "campaign" ? `Campaign: ${r.target ?? "deleted"}` : `Coupon: ${r.target ?? "deleted"}`}
              {r.note && <span className="block text-xs text-muted-foreground">{r.note}</span>}
            </td>
            <td className={`${tdClass} tabular-nums font-medium`}>{r.ratePercent}%</td>
            <td className={`${tdClass} text-muted-foreground`}>{r.durationMonths ? `${r.durationMonths} months per customer` : "Program default"}</td>
            <td className={`${tdClass} whitespace-nowrap text-xs text-muted-foreground`}>
              {r.startsAt ? fmtDay(r.startsAt) : "Now"} → {r.endsAt ? fmtDay(r.endsAt) : "no end"}
            </td>
            <td className={tdClass}>
              <StatusBadge status={live(r) ? "active" : "disabled"} label={live(r) ? "Live" : r.enabled ? "Not in window" : "Off"} />
            </td>
            <td className={tdClass}>
              {canManage && (
                <div className="flex justify-end gap-1.5">
                  <Button variant="outline" size="sm" disabled={pending} onClick={() => run(() => setRuleEnabled(r.id, !r.enabled))}>
                    {r.enabled ? "Turn off" : "Turn on"}
                  </Button>
                  <ConfirmButton variant="ghost" destructive title="Delete this rule?" description="Payments from now on use the next rule in priority. Commissions already recorded don't change." confirmLabel="Delete" action={() => deleteRule(r.id)}>
                    <Trash2 className="size-3.5" aria-hidden />
                    <span className="sr-only">Delete</span>
                  </ConfirmButton>
                </div>
              )}
            </td>
          </tr>
        ))}
      </tbody>
    </TableShell>
  )
}

export function RuleForm({ affiliateId, campaigns, coupons }: { affiliateId: number; campaigns: { id: number; name: string }[]; coupons: { id: number; code: string }[] }) {
  const blank = { scope: "affiliate", campaignId: "", couponId: "", ratePercent: "", durationMonths: "", startsAt: "", endsAt: "", note: "" }
  const [form, setForm] = useState(blank)
  const { pending, run } = useAction()
  const set = (k: keyof typeof blank) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => setForm((f) => ({ ...f, [k]: e.target.value }))
  const ready = form.ratePercent !== "" && (form.scope === "affiliate" || (form.scope === "campaign" ? form.campaignId : form.couponId))

  return (
    <form
      className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4"
      onSubmit={(e) => {
        e.preventDefault()
        run(
          () =>
            saveRule({
              affiliateId,
              scope: form.scope,
              campaignId: form.campaignId ? Number(form.campaignId) : null,
              couponId: form.couponId ? Number(form.couponId) : null,
              ratePercent: Number(form.ratePercent),
              durationMonths: form.durationMonths ? Number(form.durationMonths) : null,
              startsAt: form.startsAt ? new Date(`${form.startsAt}T00:00:00`).toISOString() : null,
              endsAt: form.endsAt ? new Date(`${form.endsAt}T23:59:59`).toISOString() : null,
              note: form.note,
            }),
          () => setForm(blank)
        )
      }}
    >
      <label className={label}>
        Applies to
        <select value={form.scope} onChange={set("scope")} className={selectClass}>
          <option value="affiliate">Everything they refer</option>
          <option value="campaign" disabled={campaigns.length === 0}>
            One campaign
          </option>
          <option value="coupon" disabled={coupons.length === 0}>
            One coupon
          </option>
        </select>
      </label>
      {form.scope === "campaign" && (
        <label className={label}>
          Campaign
          <select value={form.campaignId} onChange={set("campaignId")} className={selectClass} required>
            <option value="">Choose…</option>
            {campaigns.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
        </label>
      )}
      {form.scope === "coupon" && (
        <label className={label}>
          Coupon
          <select value={form.couponId} onChange={set("couponId")} className={selectClass} required>
            <option value="">Choose…</option>
            {coupons.map((c) => (
              <option key={c.id} value={c.id}>
                {c.code}
              </option>
            ))}
          </select>
        </label>
      )}
      <label className={label}>
        Rate (%)
        <Input type="number" min={0.5} max={100} step="0.5" value={form.ratePercent} onChange={set("ratePercent")} required />
      </label>
      <label className={label}>
        Earning window (months, optional)
        <Input type="number" min={1} max={240} step={1} value={form.durationMonths} onChange={set("durationMonths")} placeholder="Program default" />
      </label>
      <label className={label}>
        Starts (optional)
        <Input type="date" value={form.startsAt} onChange={set("startsAt")} />
      </label>
      <label className={label}>
        Ends (optional)
        <Input type="date" value={form.endsAt} onChange={set("endsAt")} />
      </label>
      <label className={`${label} sm:col-span-2`}>
        Note (internal)
        <Input value={form.note} onChange={set("note")} maxLength={200} placeholder="e.g. Launch partner deal agreed by email" />
      </label>
      <div className="sm:col-span-2 lg:col-span-4">
        <Button type="submit" disabled={pending || !ready}>
          {pending ? "Adding…" : "Add rule"}
        </Button>
      </div>
    </form>
  )
}
