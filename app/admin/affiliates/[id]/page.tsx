import Link from "next/link"
import { notFound } from "next/navigation"
import { requireAdmin } from "@/lib/admin/guard"
import { roleCan } from "@/lib/admin/access"
import { affiliateDetail } from "@/lib/affiliates/admin-queries"
import { countryName } from "@/lib/affiliates/countries"
import { resolveRule } from "@/lib/affiliates/engine"
import { FRAUD_LABELS } from "@/lib/affiliates/fraud"
import { AUTO_SKIP_LABELS, PAYOUT_STATUS_LABELS, effectiveLimits, type PayoutStatus } from "@/lib/affiliates/payout-engine"
import { autoPayoutPreview } from "@/lib/affiliates/payouts"
import { SOCIAL_KEYS, SOCIAL_LABELS, count, methodLabel, money, signedMoney } from "@/lib/affiliates/types"
import { AdminPageHeader, Panel, fmtAgo } from "@/components/admin/ui"
import { Empty, FieldRow, Kpi, KpiGrid, LEDGER_TYPE_LABELS, StatusBadge, TableShell, THead, fmtDay, tdClass, thClass } from "@/components/affiliate/ui"
import { AdjustDialog, CodeEditor, FlagToggles, LedgerRowActions, SignalActions, StandingActions, TierSelect } from "@/components/admin/affiliates/actions"
import { CouponAdmin } from "@/components/admin/affiliates/coupons-admin"
import { MethodAdminActions, PayoutControls } from "@/components/admin/affiliates/payout-admin"
import { RuleForm, RulesTable } from "@/components/admin/affiliates/program-form"

const RULE_LABELS: Record<string, string> = { affiliate: "a custom rule", campaign: "a campaign rule", coupon: "a coupon rule", tier: "their tier", default: "the program default" }
const safeUrl = (v: string | null) => (v && /^https?:\/\//i.test(v) ? v : null)

export default async function AdminAffiliateDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const admin = await requireAdmin({ affiliates: ["view"] })
  const canManage = roleCan(admin.role, { affiliates: ["manage"] })
  const id = Number((await params).id)
  if (!Number.isInteger(id) || id <= 0) notFound()
  const [d, preview] = await Promise.all([affiliateDetail(id), autoPayoutPreview(id)])
  if (!d) notFound()
  const a = d.affiliate
  const name = `${a.firstName} ${a.lastName}`.trim()
  const rule = resolveRule({ program: d.program, tiers: d.tiers, rules: d.rules.map((r) => ({ ...r, scope: r.scope as "affiliate" | "campaign" | "coupon" })), customers: d.stats.customers, tierOverrideId: a.tierId, now: new Date() })
  const website = safeUrl(a.website)
  // A method newer than the hold period isn't sent to automatically, unless an admin lifted that.
  const holdHours = preview?.settings.methodHoldHours ?? 0
  const tooNew = (m: { createdAt: Date; holdWaivedAt: Date | null }) => holdHours > 0 && !m.holdWaivedAt && Date.now() - m.createdAt.getTime() < holdHours * 3_600_000
  const decided = a.status === "approved" || a.status === "suspended"

  return (
    <div>
      <AdminPageHeader
        title={name}
        description={`${a.email} · code ${a.code} · joined ${fmtDay(a.createdAt)}`}
        action={
          <div className="flex flex-wrap items-center gap-2">
            <StatusBadge status={a.status} label={a.status === "approved" ? "Active" : undefined} />
            {canManage && <StandingActions id={a.id} status={a.status} name={name} />}
          </div>
        }
      />
      <div className="flex flex-col gap-4 p-4 sm:p-6">
        <KpiGrid>
          <Kpi label="Available" value={money(d.balances.available)} note={d.balances.processing > 0 ? `${money(d.balances.processing)} in a payout` : undefined} />
          <Kpi label="Pending" value={money(d.balances.pending)} note={`${d.program.holdDays}-day hold`} />
          <Kpi label="Lifetime earned" value={money(d.balances.lifetimeEarned)} note={`${money(d.balances.lifetimePaid)} paid out`} />
          <Kpi label="Referred revenue" value={money(d.stats.revenue)} note={`${count(d.stats.customers)} paying of ${count(d.stats.referrals)} referrals · ${count(d.stats.clicks)} clicks`} />
        </KpiGrid>

        <div className="grid gap-4 xl:grid-cols-3">
          <Panel title="Profile" className="xl:col-span-2">
            <div className="grid gap-x-8 sm:grid-cols-2">
              <div className="divide-y">
                <FieldRow label="Account">
                  {d.account ? (
                    <Link href={`/admin/users/${d.account.id}`} className="text-primary hover:underline">
                      {d.account.email}
                    </Link>
                  ) : (
                    "Deleted user"
                  )}
                </FieldRow>
                <FieldRow label="Country">{countryName(a.country)}</FieldRow>
                <FieldRow label="Traffic source">{a.trafficSource ?? "—"}</FieldRow>
                <FieldRow label="Audience size">{a.audienceSize ?? "—"}</FieldRow>
              </div>
              <div className="divide-y">
                <FieldRow label="Website">
                  {website ? (
                    <a href={website} target="_blank" rel="noreferrer nofollow" className="break-all text-primary hover:underline">
                      {website.replace(/^https?:\/\//, "")}
                    </a>
                  ) : (
                    "—"
                  )}
                </FieldRow>
                {SOCIAL_KEYS.filter((k) => a.socials?.[k]).map((k) => (
                  <FieldRow key={k} label={SOCIAL_LABELS[k]}>
                    <span className="break-all">{a.socials![k]}</span>
                  </FieldRow>
                ))}
                <FieldRow label="Approved">{fmtDay(a.approvedAt)}</FieldRow>
                <FieldRow label="Onboarded">{fmtDay(a.onboardedAt)}</FieldRow>
              </div>
            </div>
            {(a.promotionMethod || a.reason) && (
              <div className="mt-4 grid gap-3 sm:grid-cols-2">
                <div className="rounded-lg bg-muted/50 p-3">
                  <p className="text-xs text-muted-foreground">How they promote</p>
                  <p className="mt-1 whitespace-pre-wrap text-sm">{a.promotionMethod || "—"}</p>
                </div>
                <div className="rounded-lg bg-muted/50 p-3">
                  <p className="text-xs text-muted-foreground">Why they applied</p>
                  <p className="mt-1 whitespace-pre-wrap text-sm">{a.reason || "—"}</p>
                </div>
              </div>
            )}
            {a.status === "rejected" && a.rejectionReason && <p className="mt-3 text-sm text-[var(--loss)]">Rejected: {a.rejectionReason}</p>}
          </Panel>

          <Panel title="Commission & controls" description={`Earning ${rule.ratePercent}% from ${RULE_LABELS[rule.source]}${rule.tier ? ` (${rule.tier.name})` : ""}.`}>
            {canManage && decided ? (
              <div className="flex flex-col gap-4">
                <label className="flex flex-col gap-1.5 text-xs text-muted-foreground">
                  Tier
                  <TierSelect id={a.id} tierId={a.tierId} tiers={d.tiers.filter((t) => t.enabled).map((t) => ({ id: t.id, name: t.name, ratePercent: t.ratePercent }))} />
                </label>
                <FlagToggles id={a.id} payoutHold={a.payoutHold} fraudLock={a.fraudLock} />
                <div className="flex flex-col gap-1.5 text-xs text-muted-foreground">
                  Referral code
                  <CodeEditor id={a.id} code={a.code} />
                </div>
                <AdjustDialog id={a.id} name={name} />
              </div>
            ) : (
              <p className="text-sm text-muted-foreground">{decided ? "You have view-only access to the affiliate program." : "Controls unlock once the application is approved."}</p>
            )}
          </Panel>
        </div>

        {decided && preview && (
          <div className="grid gap-4 xl:grid-cols-2">
            <Panel
              title="Payout Controls"
              description={preview.decision.ok ? `The next automatic run would pay ${money(preview.decision.amount)}.` : `Automatic payout: ${AUTO_SKIP_LABELS[preview.decision.code].toLowerCase()}.`}
            >
              {canManage ? (
                <PayoutControls
                  affiliateId={a.id}
                  name={name}
                  controls={{ autoPayoutAllowed: a.autoPayoutAllowed, manualPayoutAllowed: a.manualPayoutAllowed, autoPayout: a.autoPayout, minOverride: a.minPayoutOverride == null ? null : Number(a.minPayoutOverride), maxOverride: a.maxPayoutOverride == null ? null : Number(a.maxPayoutOverride) }}
                  inherited={effectiveLimits({ programMin: d.program.minPayout, settings: preview.settings })}
                />
              ) : (
                <div className="divide-y text-sm">
                  <FieldRow label="Automatic payouts">{a.autoPayoutAllowed ? (a.autoPayout ? "On" : "Allowed, not switched on") : "Disabled by an admin"}</FieldRow>
                  <FieldRow label="Manual payout requests">{a.manualPayoutAllowed ? "On" : "Off"}</FieldRow>
                </div>
              )}
              <div className="mt-4 divide-y border-t text-sm">
                <FieldRow label="Effective minimum">{money(preview.limits.min)}{a.minPayoutOverride == null ? " (inherited)" : " (custom)"}</FieldRow>
                <FieldRow label="Effective maximum">{preview.limits.max == null ? "None" : money(preview.limits.max)}{a.maxPayoutOverride == null ? " (inherited)" : " (custom)"}</FieldRow>
                <FieldRow label="Their threshold">{money(preview.threshold)}</FieldRow>
                <FieldRow label="Payout hold">{a.payoutHold ? "Active" : "None"}{a.fraudLock ? " · fraud lock" : ""}</FieldRow>
              </div>
            </Panel>

            <Panel title="Payout methods" description="Masked. The full account is shown, and logged, only when paying a payout.">
              {d.methods.filter((m) => m.status !== "removed").length === 0 ? (
                <p className="text-sm text-muted-foreground">No payout method on file.</p>
              ) : (
                <ul className="divide-y text-sm">
                  {d.methods
                    .filter((m) => m.status !== "removed")
                    .map((m) => (
                      <li key={m.id} className="flex flex-wrap items-center justify-between gap-3 py-2">
                        <span className="min-w-0">
                          {m.nickname || methodLabel(m.type)}
                          {m.isDefault && <span className="ms-2 rounded-full bg-primary/12 px-2 py-0.5 text-xs font-medium text-primary">Default</span>}
                          <span className="block truncate font-mono text-xs text-muted-foreground">
                            {methodLabel(m.type)} · {m.label}
                          </span>
                          {m.holdUntil && m.holdUntil > new Date() ? (
                            <span className="block text-xs text-[var(--chart-4)]">Security hold until {fmtDay(m.holdUntil)}</span>
                          ) : tooNew(m) ? (
                            <span className="block text-xs text-[var(--chart-4)]">Added less than {preview.settings.methodHoldHours} hours ago — not sent to automatically yet</span>
                          ) : m.holdWaivedAt ? (
                            <span className="block text-xs text-muted-foreground">Security hold removed by an admin {fmtDay(m.holdWaivedAt)}</span>
                          ) : null}
                        </span>
                        <span className="flex items-center gap-2">
                          <StatusBadge status={m.status} />
                          {canManage && <MethodAdminActions id={m.id} status={m.status} name={`${methodLabel(m.type)} ${m.label}`} held={(!!m.holdUntil && m.holdUntil > new Date()) || tooNew(m)} />}
                        </span>
                      </li>
                    ))}
                </ul>
              )}
            </Panel>
          </div>
        )}

        {decided && (
          <section className="flex flex-col gap-3">
            <h2 className="text-sm font-semibold">Custom commission rules</h2>
            {canManage && (
              <div className="rounded-xl border bg-card p-5">
                <RuleForm affiliateId={a.id} campaigns={d.campaigns.map((c) => ({ id: c.id, name: c.name }))} coupons={d.coupons.map((c) => ({ id: c.id, code: c.code }))} />
              </div>
            )}
            <RulesTable
              canManage={canManage}
              showAffiliate={false}
              rules={d.rules.map((r) => ({
                id: r.id,
                scope: r.scope,
                affiliateId: a.id,
                affiliate: name,
                target: r.scope === "campaign" ? (d.campaigns.find((c) => c.id === r.campaignId)?.name ?? null) : r.scope === "coupon" ? (d.coupons.find((c) => c.id === r.couponId)?.code ?? null) : null,
                ratePercent: r.ratePercent,
                durationMonths: r.durationMonths,
                startsAt: r.startsAt ? r.startsAt.toISOString() : null,
                endsAt: r.endsAt ? r.endsAt.toISOString() : null,
                enabled: r.enabled,
                note: r.note,
              }))}
            />
          </section>
        )}

        <section className="flex flex-col gap-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h2 className="text-sm font-semibold">Ledger</h2>
            <p className="text-xs text-muted-foreground">Latest 40 entries. Nothing here is ever edited or deleted — corrections are new lines.</p>
          </div>
          {d.ledger.length === 0 ? (
            <div className="rounded-xl border bg-card">
              <Empty title="No ledger entries yet" />
            </div>
          ) : (
            <TableShell>
              <THead>
                <tr>
                  <th className={thClass}>Date</th>
                  <th className={thClass}>Type</th>
                  <th className={thClass}>Referral</th>
                  <th className={thClass}>Detail</th>
                  <th className={thClass}>Status</th>
                  <th className={`${thClass} text-end`}>Amount</th>
                  <th className={`${thClass} text-end`}>Actions</th>
                </tr>
              </THead>
              <tbody className="divide-y">
                {d.ledger.map((l) => (
                  <tr key={l.id}>
                    <td className={`${tdClass} whitespace-nowrap text-muted-foreground`}>{fmtDay(l.createdAt)}</td>
                    <td className={`${tdClass} whitespace-nowrap`}>{LEDGER_TYPE_LABELS[l.type] ?? l.type}</td>
                    <td className={`${tdClass} font-mono text-xs`}>{l.referral ?? "—"}</td>
                    <td className={`${tdClass} text-xs text-muted-foreground`}>
                      {l.ratePercent != null ? `${l.ratePercent}% · ${l.ruleSource ?? ""}` : (l.note ?? "—")}
                      {l.status === "pending" && l.holdUntil && <span className="block">Clears {fmtDay(l.holdUntil)}</span>}
                    </td>
                    <td className={tdClass}>
                      <StatusBadge status={l.status} />
                    </td>
                    <td className={`${tdClass} whitespace-nowrap text-end tabular-nums font-medium ${l.amount < 0 ? "text-[var(--loss)]" : ""}`}>{signedMoney(l.amount)}</td>
                    <td className={tdClass}>{canManage && <LedgerRowActions id={l.id} type={l.type} status={l.status} amount={l.amount} />}</td>
                  </tr>
                ))}
              </tbody>
            </TableShell>
          )}
        </section>

        <div className="grid gap-4 xl:grid-cols-2">
          <Panel title="Referrals" description="Latest 25. Customer emails are visible to admins only.">
            {d.referrals.length === 0 ? (
              <Empty title="No referrals yet" />
            ) : (
              <TableShell className="border-0">
                <THead>
                  <tr>
                    <th className={thClass}>Customer</th>
                    <th className={thClass}>Status</th>
                    <th className={thClass}>Source</th>
                    <th className={`${thClass} text-end`}>Revenue</th>
                  </tr>
                </THead>
                <tbody className="divide-y">
                  {d.referrals.map((r) => (
                    <tr key={r.id}>
                      <td className={tdClass}>
                        <Link href={`/admin/users/${r.userId}`} className="hover:underline">
                          {r.email ?? "Deleted user"}
                        </Link>
                        <p className="font-mono text-xs text-muted-foreground">
                          {r.publicId} · {fmtDay(r.createdAt)}
                        </p>
                      </td>
                      <td className={tdClass}>
                        <StatusBadge status={r.status} />
                      </td>
                      <td className={`${tdClass} capitalize text-muted-foreground`}>{r.source}</td>
                      <td className={`${tdClass} text-end tabular-nums`}>{money(r.revenue)}</td>
                    </tr>
                  ))}
                </tbody>
              </TableShell>
            )}
          </Panel>

          <div className="flex flex-col gap-4">
            <Panel title="Payouts" action={<Link href="/admin/affiliates/payouts" className="text-xs font-medium text-primary hover:underline">Payout queue</Link>}>
              {d.payouts.length === 0 ? (
                <p className="text-sm text-muted-foreground">No payouts requested.</p>
              ) : (
                <ul className="divide-y text-sm">
                  {d.payouts.map((p) => (
                    <li key={p.id} className="flex items-center justify-between gap-3 py-2">
                      <span>
                        <Link href={`/admin/affiliates/payouts/${p.id}`} className="font-mono text-xs text-primary hover:underline">
                          PO-{p.id}
                        </Link>{" "}
                        {methodLabel(p.methodType)} <span className="font-mono text-xs text-muted-foreground">{p.methodLabel}</span>
                        <span className="block text-xs text-muted-foreground">
                          {fmtDay(p.requestedAt)} · {p.mode === "automatic" ? "automatic" : "requested"}
                        </span>
                      </span>
                      <span className="flex items-center gap-2">
                        <StatusBadge status={p.status} label={PAYOUT_STATUS_LABELS[p.status as PayoutStatus]} />
                        <span className="tabular-nums font-medium">{money(p.amount)}</span>
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </Panel>

            <Panel title="Coupons" description="Their permanent code, the codes you generate for them, and whether they can make their own.">
              {canManage && decided ? (
                <CouponAdmin
                  affiliateId={a.id}
                  name={name}
                  ready={a.status === "approved" && !!a.onboardedAt}
                  access={{ couponsEnabled: a.couponsEnabled, maxCouponPercent: a.maxCouponPercent }}
                  program={{ couponsEnabled: d.program.couponsEnabled, maxCouponPercent: d.program.maxCouponPercent, permanentPercent: d.program.permanentCouponPercent, permanentMonths: d.program.permanentCouponMonths }}
                  coupons={d.coupons.map((c) => ({ id: c.id, code: c.code, percent: c.discountValue, durationMonths: c.durationMonths, uses: c.uses, status: c.status, permanent: c.permanent, byAdmin: !c.permanent && !!c.createdBy && c.createdBy !== "affiliate" && c.createdBy !== "system" }))}
                />
              ) : d.coupons.length === 0 ? (
                <p className="text-sm text-muted-foreground">No coupons created.</p>
              ) : (
                <ul className="divide-y text-sm">
                  {d.coupons.map((c) => (
                    <li key={c.id} className="flex items-center justify-between gap-3 py-2">
                      <span>
                        <span className="font-mono font-medium">{c.code}</span>
                        <span className="block text-xs text-muted-foreground">
                          {c.discountValue}% · {count(c.uses)} use{c.uses === 1 ? "" : "s"}
                          {c.permanent ? " · permanent" : ""}
                        </span>
                      </span>
                      <StatusBadge status={c.status} />
                    </li>
                  ))}
                </ul>
              )}
            </Panel>

            <Panel title="Risk signals" action={<Link href="/admin/affiliates/fraud" className="text-xs font-medium text-primary hover:underline">All signals</Link>}>
              {d.signals.length === 0 ? (
                <p className="text-sm text-muted-foreground">Nothing flagged.</p>
              ) : (
                <ul className="divide-y text-sm">
                  {d.signals.map((s) => (
                    <li key={s.id} className="flex flex-wrap items-center justify-between gap-3 py-2">
                      <span>
                        {FRAUD_LABELS[s.type] ?? s.type}
                        <span className="block text-xs text-muted-foreground">{fmtAgo(s.createdAt)}</span>
                      </span>
                      <span className="flex items-center gap-2">
                        <StatusBadge status={s.risk} />
                        <StatusBadge status={s.status} />
                        {canManage && <SignalActions id={s.id} status={s.status} />}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </Panel>
          </div>
        </div>
      </div>
    </div>
  )
}
