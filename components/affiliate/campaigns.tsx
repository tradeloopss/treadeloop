"use client"

import { useState } from "react"
import { Pencil, Plus, Target } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Textarea } from "@/components/ui/textarea"
import { changeCampaignStatus, saveCampaign } from "@/app/actions/affiliate"
import { LANDING_PAGES, count, money } from "@/lib/affiliates/types"
import { ConfirmButton } from "./confirm"
import { CopyButton } from "./copy"
import { Empty, StatusBadge, TableShell, THead, selectClass, tdClass, thClass } from "./ui"
import { useAction } from "./use-action"

export type CampaignView = {
  id: number
  name: string
  description: string | null
  landingPage: string
  utmSource: string | null
  utmMedium: string | null
  utmCampaign: string | null
  utmContent: string | null
  status: string
  url: string | null
  stats: { clicks: number; signups: number; customers: number; revenue: number; commission: number }
}

const BLANK = { name: "", description: "", landingPage: "/", utmSource: "", utmMedium: "", utmCampaign: "", utmContent: "" }

function CampaignDialog({ open, onOpenChange, campaign }: { open: boolean; onOpenChange: (open: boolean) => void; campaign: CampaignView | null }) {
  const { pending, run } = useAction()
  const [form, setForm] = useState(BLANK)
  const [seeded, setSeeded] = useState<number | "new" | null>(null)
  // Re-seed the fields whenever the dialog opens for a different campaign.
  const key = campaign?.id ?? "new"
  if (open && seeded !== key) {
    setSeeded(key)
    setForm(campaign ? { name: campaign.name, description: campaign.description ?? "", landingPage: campaign.landingPage, utmSource: campaign.utmSource ?? "", utmMedium: campaign.utmMedium ?? "", utmCampaign: campaign.utmCampaign ?? "", utmContent: campaign.utmContent ?? "" } : BLANK)
  }
  if (!open && seeded !== null) setSeeded(null)
  const set = (k: keyof typeof BLANK) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) => setForm((f) => ({ ...f, [k]: e.target.value }))

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <form
          className="grid gap-4"
          onSubmit={(e) => {
            e.preventDefault()
            run(() => saveCampaign(campaign?.id ?? null, form), () => onOpenChange(false))
          }}
        >
          <DialogHeader>
            <DialogTitle>{campaign ? "Edit campaign" : "New campaign"}</DialogTitle>
            <DialogDescription>A campaign gets its own tracking link, so you can tell your channels apart.</DialogDescription>
          </DialogHeader>
          <label className="flex flex-col gap-1.5 text-xs text-muted-foreground">
            Name
            <Input value={form.name} onChange={set("name")} maxLength={60} placeholder="YouTube review — March" required autoFocus />
          </label>
          <label className="flex flex-col gap-1.5 text-xs text-muted-foreground">
            Notes (only you see these)
            <Textarea value={form.description} onChange={set("description")} rows={2} maxLength={300} />
          </label>
          <label className="flex flex-col gap-1.5 text-xs text-muted-foreground">
            Landing page
            <select value={form.landingPage} onChange={set("landingPage")} className={selectClass}>
              {LANDING_PAGES.map((p) => (
                <option key={p.path} value={p.path}>
                  {p.label}
                </option>
              ))}
            </select>
          </label>
          <fieldset className="grid gap-3 sm:grid-cols-2">
            <legend className="mb-2 text-xs font-medium text-foreground">UTM tags (optional)</legend>
            <label className="flex flex-col gap-1.5 text-xs text-muted-foreground">
              Source
              <Input value={form.utmSource} onChange={set("utmSource")} maxLength={60} placeholder="youtube" />
            </label>
            <label className="flex flex-col gap-1.5 text-xs text-muted-foreground">
              Medium
              <Input value={form.utmMedium} onChange={set("utmMedium")} maxLength={60} placeholder="video" />
            </label>
            <label className="flex flex-col gap-1.5 text-xs text-muted-foreground">
              Campaign
              <Input value={form.utmCampaign} onChange={set("utmCampaign")} maxLength={60} placeholder="Defaults to the name" />
            </label>
            <label className="flex flex-col gap-1.5 text-xs text-muted-foreground">
              Content
              <Input value={form.utmContent} onChange={set("utmContent")} maxLength={60} placeholder="description-link" />
            </label>
          </fieldset>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)} disabled={pending}>
              Cancel
            </Button>
            <Button type="submit" disabled={pending}>
              {pending ? "Saving…" : campaign ? "Save changes" : "Create campaign"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

export function CampaignsManager({ campaigns }: { campaigns: CampaignView[] }) {
  const [open, setOpen] = useState(false)
  const [editing, setEditing] = useState<CampaignView | null>(null)
  const [showArchived, setShowArchived] = useState(false)
  const archived = campaigns.filter((c) => c.status === "archived").length
  const visible = campaigns.filter((c) => showArchived || c.status !== "archived")
  const openFor = (c: CampaignView | null) => {
    setEditing(c)
    setOpen(true)
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm text-muted-foreground">
          {campaigns.length - archived} active campaign{campaigns.length - archived === 1 ? "" : "s"}
          {archived > 0 && (
            <>
              {" · "}
              <button type="button" className="font-medium text-primary hover:underline" onClick={() => setShowArchived((v) => !v)}>
                {showArchived ? "Hide" : "Show"} {archived} archived
              </button>
            </>
          )}
        </p>
        <Button onClick={() => openFor(null)}>
          <Plus className="size-4" aria-hidden /> New campaign
        </Button>
      </div>

      {visible.length === 0 ? (
        <div className="rounded-xl border bg-card">
          <Empty icon={Target} title="No campaigns yet" action={<Button onClick={() => openFor(null)}>Create your first campaign</Button>}>
            Make one per channel — a video, a newsletter, a Discord server — and see which one actually converts.
          </Empty>
        </div>
      ) : (
        <TableShell>
          <THead>
            <tr>
              <th className={thClass}>Campaign</th>
              <th className={thClass}>Status</th>
              <th className={`${thClass} text-end`}>Clicks</th>
              <th className={`${thClass} text-end`}>Sign-ups</th>
              <th className={`${thClass} text-end`}>Customers</th>
              <th className={`${thClass} text-end`}>Commission</th>
              <th className={`${thClass} text-end`}>Actions</th>
            </tr>
          </THead>
          <tbody className="divide-y">
            {visible.map((c) => (
              <tr key={c.id}>
                <td className={tdClass}>
                  <p className="font-medium">{c.name}</p>
                  <p className="max-w-64 truncate text-xs text-muted-foreground">{c.description || LANDING_PAGES.find((p) => p.path === c.landingPage)?.label}</p>
                </td>
                <td className={tdClass}>
                  <StatusBadge status={c.status} />
                </td>
                <td className={`${tdClass} text-end tabular-nums`}>{count(c.stats.clicks)}</td>
                <td className={`${tdClass} text-end tabular-nums`}>{count(c.stats.signups)}</td>
                <td className={`${tdClass} text-end tabular-nums`}>{count(c.stats.customers)}</td>
                <td className={`${tdClass} text-end tabular-nums font-medium`}>{money(c.stats.commission)}</td>
                <td className={tdClass}>
                  <div className="flex items-center justify-end gap-1.5">
                    {c.url && <CopyButton value={c.url} label="Copy link" />}
                    <Button type="button" variant="outline" size="sm" onClick={() => openFor(c)}>
                      <Pencil className="size-3.5" aria-hidden /> Edit
                    </Button>
                    {c.status === "active" ? (
                      <ConfirmButton title={`Archive “${c.name}”?`} description="It leaves your active list. Its link keeps working and its history is kept — you can restore it any time." confirmLabel="Archive" action={() => changeCampaignStatus(c.id, "archived")}>
                        Archive
                      </ConfirmButton>
                    ) : (
                      <ConfirmButton title={`Restore “${c.name}”?`} confirmLabel="Restore" action={() => changeCampaignStatus(c.id, "active")}>
                        Restore
                      </ConfirmButton>
                    )}
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </TableShell>
      )}
      <CampaignDialog open={open} onOpenChange={setOpen} campaign={editing} />
    </div>
  )
}
