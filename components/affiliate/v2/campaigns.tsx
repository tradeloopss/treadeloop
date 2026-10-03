"use client"

import { useEffect, useState } from "react"
import Link from "next/link"
import { ArrowRight, Pencil, Plus, Target } from "lucide-react"
import { changeCampaignStatus } from "@/app/actions/affiliate"
import { rate } from "@/lib/affiliates/engine"
import { money, pct } from "@/lib/affiliates/types"
import { CampaignDialog, type CampaignView } from "@/components/affiliate/campaigns"
import { ConfirmButton } from "@/components/affiliate/confirm"
import { affiliateHref } from "@/lib/urls"
import { ReferralLinkActions } from "./referral-link"
import { EmptyState, IconTile, StatusChip, btnClass, ghostBtnClass } from "./ui"

// Campaign cards: the numbers, the link, and the existing create / edit window.

export function NewCampaignButton({ autoOpen = false, label = "New campaign" }: { autoOpen?: boolean; label?: string }) {
  const [open, setOpen] = useState(false)
  useEffect(() => {
    if (autoOpen) setOpen(true)
  }, [autoOpen])
  return (
    <>
      <button type="button" onClick={() => setOpen(true)} className={btnClass}>
        <Plus className="size-4" aria-hidden /> {label}
      </button>
      <CampaignDialog open={open} onOpenChange={setOpen} campaign={null} />
    </>
  )
}

export function EditCampaignButton({ campaign }: { campaign: CampaignView }) {
  const [open, setOpen] = useState(false)
  return (
    <>
      <button type="button" onClick={() => setOpen(true)} className={ghostBtnClass}>
        <Pencil className="size-4" aria-hidden /> Edit
      </button>
      <CampaignDialog open={open} onOpenChange={setOpen} campaign={campaign} />
    </>
  )
}

export function CampaignCards({ campaigns, rateText }: { campaigns: CampaignView[]; rateText: string }) {
  if (campaigns.length === 0)
    return (
      <EmptyState icon={Target} title="No campaigns yet" action={<NewCampaignButton label="Create a campaign" />}>
        Give each channel — a YouTube video, an Instagram bio, a newsletter — its own link, and see which one converts.
      </EmptyState>
    )
  return (
    <ul className="grid gap-4 md:grid-cols-2 2xl:grid-cols-3">
      {campaigns.map((c) => {
        const s = c.stats
        const conv = s.clicks ? pct(rate(s.customers, s.clicks)) : "—"
        return (
          <li key={c.id} className="v2-card flex min-w-0 flex-col p-4 sm:p-5">
            <div className="flex items-start gap-3">
              <IconTile icon={Target} />
              <div className="min-w-0 flex-1">
                <p className="flex items-center gap-2">
                  <span className="truncate text-[15px] font-semibold">{c.name}</span>
                  {c.status !== "active" && <StatusChip status={c.status} />}
                </p>
                <p className="line-clamp-2 text-xs text-muted-foreground">{c.description || [c.utmSource && `Source: ${c.utmSource}`, c.utmMedium && `Medium: ${c.utmMedium}`].filter(Boolean).join(" · ") || "No notes"}</p>
              </div>
              <span className="shrink-0 rounded-lg border border-primary/30 bg-primary/10 px-2 py-1 text-xs font-semibold text-primary">{rateText}</span>
            </div>
            <dl className="mt-4 grid grid-cols-3 gap-2 text-center sm:grid-cols-6">
              {(
                [
                  ["Clicks", s.clicks.toLocaleString("en-US")],
                  ["Sign-ups", s.signups.toLocaleString("en-US")],
                  ["Customers", s.customers.toLocaleString("en-US")],
                  ["Conversion", conv],
                  ["Revenue", money(s.revenue)],
                  ["Earned", money(s.commission)],
                ] as const
              ).map(([k, v]) => (
                <div key={k} className="min-w-0 rounded-lg bg-muted/40 px-1 py-2">
                  <dt className="truncate text-[10px] text-muted-foreground">{k}</dt>
                  <dd className="truncate text-[13px] font-semibold tabular-nums">{v}</dd>
                </div>
              ))}
            </dl>
            {c.url && <ReferralLinkActions url={c.url} size="sm" className="mt-3" />}
            <div className="mt-3 flex flex-wrap items-center gap-2 border-t pt-3">
              <Link href={affiliateHref(`/affiliate/v2/campaigns/${c.id}`)} className={btnClass}>
                View Campaign <ArrowRight className="size-4" aria-hidden />
              </Link>
              <EditCampaignButton campaign={c} />
              {c.status === "active" ? (
                <ConfirmButton title="Archive this campaign?" description="Its link keeps counting clicks and referrals; it just moves out of your active list." confirmLabel="Archive" action={() => changeCampaignStatus(c.id, "archived")} className="h-9">
                  Archive
                </ConfirmButton>
              ) : (
                <ConfirmButton title="Restore this campaign?" confirmLabel="Restore" action={() => changeCampaignStatus(c.id, "active")} className="h-9">
                  Restore
                </ConfirmButton>
              )}
            </div>
          </li>
        )
      })}
    </ul>
  )
}
