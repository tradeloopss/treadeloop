"use client"

import { useState } from "react"
import { Trash2 } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { deleteRule, deleteTier, saveProgramSettings, saveRule, saveTier, setRuleEnabled } from "@/app/actions/admin-affiliates"
import type { ProgramSettings } from "@/lib/affiliates/types"
import { ConfirmButton } from "@/components/affiliate/confirm"
import { Empty, StatusBadge, TableShell, THead, fmtDay, selectClass, tdClass, thClass } from "@/components/affiliate/ui"
import { useAction } from "@/components/affiliate/use-action"

const label = "flex flex-col gap-1.5 text-xs text-muted-foreground"

// --- Program settings -----------------------------------------------------------

export function ProgramForm({ program, canManage }: { program: ProgramSettings; canManage: boolean }) {
  const [form, setForm] = useState({ ...program, durationMonths: program.durationMonths == null ? "" : String(program.durationMonths) })
  const { pending, run } = useAction()
  const num = (k: "defaultRate" | "cookieDays" | "minPayout" | "holdDays" | "maxCouponPercent") => (e: React.ChangeEvent<HTMLInputElement>) => setForm((f) => ({ ...f, [k]: e.target.value as unknown as number }))
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
            <span>Match your refund window.</span>
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
              ["couponsEnabled", "Let affiliates create coupons", "Each coupon is a real promo code at checkout."],
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
        {form.couponsEnabled && (
          <label className={`${label} max-w-xs`}>
            Largest coupon discount (%)
            <Input type="number" min={1} max={100} step={1} value={form.maxCouponPercent} onChange={num("maxCouponPercent")} required />
          </label>
        )}
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

export type TierView = { id: number; name: string; minCustomers: number; ratePercent: number; enabled: boolean; affiliates: number }

function TierRow({ tier, canManage }: { tier: TierView | null; canManage: boolean }) {
  const [form, setForm] = useState({ name: tier?.name ?? "", minCustomers: String(tier?.minCustomers ?? ""), ratePercent: String(tier?.ratePercent ?? ""), enabled: tier?.enabled ?? true })
  const { pending, run } = useAction()
  return (
    <tr>
      <td className={tdClass}>
        <Input aria-label="Tier name" value={form.name} onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))} maxLength={40} placeholder="New tier name" disabled={!canManage} />
      </td>
      <td className={tdClass}>
        <Input aria-label="Paying customers needed" type="number" min={0} step={1} value={form.minCustomers} onChange={(e) => setForm((f) => ({ ...f, minCustomers: e.target.value }))} className="w-28" disabled={!canManage} />
      </td>
      <td className={tdClass}>
        <Input aria-label="Commission rate (%)" type="number" min={0.5} max={90} step="0.5" value={form.ratePercent} onChange={(e) => setForm((f) => ({ ...f, ratePercent: e.target.value }))} className="w-24" disabled={!canManage} />
      </td>
      <td className={tdClass}>
        <input aria-label="Enabled" type="checkbox" role="switch" checked={form.enabled} onChange={(e) => setForm((f) => ({ ...f, enabled: e.target.checked }))} className="size-4 accent-[var(--primary)]" disabled={!canManage} />
      </td>
      <td className={`${tdClass} tabular-nums text-muted-foreground`}>{tier ? tier.affiliates : "—"}</td>
      <td className={tdClass}>
        {canManage && (
          <div className="flex justify-end gap-1.5">
            <Button
              variant={tier ? "outline" : "default"}
              size="sm"
              disabled={pending || !form.name.trim() || form.minCustomers === "" || form.ratePercent === ""}
              onClick={() =>
                run(
                  () => saveTier({ id: tier?.id ?? null, name: form.name, minCustomers: Number(form.minCustomers), ratePercent: Number(form.ratePercent), enabled: form.enabled }),
                  () => {
                    if (!tier) setForm({ name: "", minCustomers: "", ratePercent: "", enabled: true })
                  }
                )
              }
            >
              {tier ? "Save" : "Add tier"}
            </Button>
            {tier && (
              <ConfirmButton variant="ghost" destructive title={`Delete the ${tier.name} tier?`} description="Affiliates in it fall back to whichever remaining tier they qualify for (or the default rate). Commissions already recorded don't change." confirmLabel="Delete" action={() => deleteTier(tier.id)}>
                <Trash2 className="size-3.5" aria-hidden />
                <span className="sr-only">Delete</span>
              </ConfirmButton>
            )}
          </div>
        )}
      </td>
    </tr>
  )
}

export function TiersEditor({ tiers, canManage }: { tiers: TierView[]; canManage: boolean }) {
  return (
    <TableShell>
      <THead>
        <tr>
          <th className={thClass}>Tier</th>
          <th className={thClass}>Paying customers</th>
          <th className={thClass}>Rate (%)</th>
          <th className={thClass}>Enabled</th>
          <th className={thClass}>Affiliates</th>
          <th className={`${thClass} text-end`}>Actions</th>
        </tr>
      </THead>
      <tbody className="divide-y">
        {tiers.map((t) => (
          <TierRow key={t.id} tier={t} canManage={canManage} />
        ))}
        {canManage && <TierRow key="new" tier={null} canManage />}
      </tbody>
    </TableShell>
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
        <Input type="number" min={0.5} max={90} step="0.5" value={form.ratePercent} onChange={set("ratePercent")} required />
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
