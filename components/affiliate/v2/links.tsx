"use client"

import { useEffect, useState } from "react"
import { AtSign, Camera, Clapperboard, Globe, Link2, Mail, MessageCircle, Pencil, Plus, Send, Video, type LucideIcon } from "lucide-react"
import { changeLinkStatus, saveCampaign } from "@/app/actions/affiliate"
import { rate } from "@/lib/affiliates/engine"
import { LANDING_PAGES, money, pct } from "@/lib/affiliates/types"
import { CampaignDialog, type CampaignView } from "@/components/affiliate/campaigns"
import { ConfirmButton } from "@/components/affiliate/confirm"
import { useAction } from "@/components/affiliate/use-action"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { ReferralLinkActions } from "./referral-link"
import { EmptyState, IconTile, StatusChip, btnClass, ghostBtnClass } from "./ui"
import { cn } from "@/lib/utils"

// Smart links: a tracking link per channel. A smart link is a campaign tagged
// with its channel (utm_source / utm_medium / utm_campaign), created through
// the same server action — and validated by the same rules — as any campaign.

export type LinkV2View = {
  id: number
  url: string
  label: string
  channel: string | null
  landing: string
  isDefault: boolean
  status: string
  campaign: CampaignView | null
  stats: { clicks: number; signups: number; customers: number; revenue: number; commission: number }
}

const CHANNELS: { key: string; label: string; medium: string; icon: LucideIcon }[] = [
  { key: "youtube", label: "YouTube", medium: "video", icon: Video },
  { key: "instagram", label: "Instagram", medium: "social", icon: Camera },
  { key: "x", label: "X (Twitter)", medium: "social", icon: AtSign },
  { key: "tiktok", label: "TikTok", medium: "video", icon: Clapperboard },
  { key: "telegram", label: "Telegram", medium: "community", icon: Send },
  { key: "discord", label: "Discord", medium: "community", icon: MessageCircle },
  { key: "website", label: "Website / blog", medium: "referral", icon: Globe },
  { key: "email", label: "Email / newsletter", medium: "email", icon: Mail },
]
const channelIcon = (c: string | null) => CHANNELS.find((x) => x.key === c)?.icon ?? Link2
const slug = (s: string) => s.toLowerCase().normalize("NFKD").replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "").slice(0, 40)

export function NewSmartLinkButton({ autoOpen = false }: { autoOpen?: boolean }) {
  const [open, setOpen] = useState(false)
  const [channel, setChannel] = useState("youtube")
  const [name, setName] = useState("")
  const [landing, setLanding] = useState("/")
  const { pending, run } = useAction()
  useEffect(() => {
    if (autoOpen) setOpen(true)
  }, [autoOpen])
  const ch = CHANNELS.find((c) => c.key === channel)!
  const preview = `utm_source=${ch.key}&utm_medium=${ch.medium}&utm_campaign=${slug(name) || "…"}`
  return (
    <>
      <button type="button" onClick={() => setOpen(true)} className={btnClass}>
        <Plus className="size-4" aria-hidden /> Create smart link
      </button>
      <Dialog open={open} onOpenChange={(o) => !pending && setOpen(o)}>
        <DialogContent className="max-h-[92svh] overflow-y-auto max-sm:top-auto max-sm:bottom-0 max-sm:max-w-full max-sm:translate-y-0 max-sm:rounded-b-none sm:max-w-lg">
          <form
            className="grid gap-4"
            onSubmit={(e) => {
              e.preventDefault()
              run(
                () => saveCampaign(null, { name: name || `${ch.label} link`, landingPage: landing, utmSource: ch.key, utmMedium: ch.medium, utmCampaign: slug(name || ch.label) }),
                () => {
                  setOpen(false)
                  setName("")
                }
              )
            }}
          >
            <DialogHeader>
              <DialogTitle className="text-base font-semibold">Create a smart link</DialogTitle>
              <DialogDescription>A link of its own for one channel, so you can see exactly what it brings in.</DialogDescription>
            </DialogHeader>
            <fieldset>
              <legend className="mb-2 text-sm font-medium">Channel</legend>
              <div role="radiogroup" className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                {CHANNELS.map((c) => (
                  <button key={c.key} type="button" role="radio" aria-checked={channel === c.key} onClick={() => setChannel(c.key)} className={cn("flex min-h-11 items-center gap-2 rounded-xl border px-2.5 text-start text-xs font-medium", channel === c.key ? "border-primary bg-primary/10" : "hover:bg-muted/50")}>
                    <c.icon className="size-4 shrink-0 text-primary" aria-hidden /> {c.label}
                  </button>
                ))}
              </div>
            </fieldset>
            <label className="grid gap-1.5 text-sm font-medium">
              Name
              <input value={name} onChange={(e) => setName(e.target.value.slice(0, 60))} placeholder={`${ch.label} October campaign`} className="h-10 rounded-xl border border-input bg-background px-3 text-sm font-normal outline-none focus-visible:ring-2 focus-visible:ring-ring/50" />
            </label>
            <label className="grid gap-1.5 text-sm font-medium">
              Landing page
              <select value={landing} onChange={(e) => setLanding(e.target.value)} className="h-10 rounded-xl border border-input bg-background px-3 text-sm font-normal outline-none focus-visible:ring-2 focus-visible:ring-ring/50">
                {LANDING_PAGES.map((p) => (
                  <option key={p.path} value={p.path}>
                    {p.label}
                  </option>
                ))}
              </select>
            </label>
            <p className="rounded-xl bg-muted/50 px-3 py-2 font-mono text-[11px] break-all text-muted-foreground">…?ref=…&amp;{preview}</p>
            <DialogFooter className="max-sm:rounded-b-none">
              <button type="button" className={ghostBtnClass} onClick={() => setOpen(false)} disabled={pending}>
                Cancel
              </button>
              <button type="submit" className={btnClass} disabled={pending}>
                {pending ? "Creating…" : "Create link"}
              </button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </>
  )
}

function EditLink({ campaign }: { campaign: CampaignView }) {
  const [open, setOpen] = useState(false)
  return (
    <>
      <button type="button" onClick={() => setOpen(true)} className={cn(ghostBtnClass, "h-8 px-2.5 text-xs")}>
        <Pencil className="size-3.5" aria-hidden /> Edit
      </button>
      <CampaignDialog open={open} onOpenChange={setOpen} campaign={campaign} />
    </>
  )
}

export function LinkCards({ links }: { links: LinkV2View[] }) {
  if (links.length === 0) return <EmptyState icon={Link2} title="No links yet" action={<NewSmartLinkButton />}>Create a smart link for each channel you share on.</EmptyState>
  return (
    <ul className="grid gap-4 lg:grid-cols-2">
      {links.map((l) => {
        const s = l.stats
        return (
          <li key={l.id} className={cn("v2-card flex min-w-0 flex-col p-4 sm:p-5", l.status !== "active" && "opacity-75")}>
            <div className="flex items-start gap-3">
              <IconTile icon={channelIcon(l.channel)} />
              <div className="min-w-0 flex-1">
                <p className="flex items-center gap-2">
                  <span className="truncate text-[15px] font-semibold">{l.label}</span>
                  {l.isDefault && <span className="rounded-full bg-primary/12 px-2 py-0.5 text-[10px] font-semibold text-primary">Main link</span>}
                  {l.status !== "active" && <StatusChip status={l.status} />}
                </p>
                <p className="truncate text-xs text-muted-foreground">
                  {l.channel ? `${CHANNELS.find((c) => c.key === l.channel)?.label ?? l.channel} · ` : ""}
                  {l.landing}
                </p>
              </div>
            </div>
            <dl className="mt-3 grid grid-cols-3 gap-2 text-center sm:grid-cols-6">
              {(
                [
                  ["Clicks", s.clicks.toLocaleString("en-US")],
                  ["Sign-ups", s.signups.toLocaleString("en-US")],
                  ["Customers", s.customers.toLocaleString("en-US")],
                  ["Conversion", s.clicks ? pct(rate(s.customers, s.clicks)) : "—"],
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
            <ReferralLinkActions url={l.url} size="sm" className="mt-3" />
            {(l.campaign || !l.isDefault) && (
              <div className="mt-3 flex flex-wrap gap-2 border-t pt-3">
                {l.campaign && <EditLink campaign={l.campaign} />}
                {!l.isDefault &&
                  (l.status === "active" ? (
                    <ConfirmButton title="Disable this link?" description="Visits through it stop being counted and stop attributing sign-ups to you. You can enable it again later." confirmLabel="Disable" destructive action={() => changeLinkStatus(l.id, "disabled")} className="h-8">
                      Disable
                    </ConfirmButton>
                  ) : (
                    <ConfirmButton title="Enable this link?" confirmLabel="Enable" action={() => changeLinkStatus(l.id, "active")} className="h-8">
                      Enable
                    </ConfirmButton>
                  ))}
              </div>
            )}
          </li>
        )
      })}
    </ul>
  )
}
