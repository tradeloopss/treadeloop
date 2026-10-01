"use client"

import { useMemo, useState } from "react"
import { Link2, Plus } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { addLink, changeLinkStatus } from "@/app/actions/affiliate"
import { buildTrackingUrl, cleanUtm } from "@/lib/affiliates/engine"
import { LANDING_PAGES, count } from "@/lib/affiliates/types"
import { ConfirmButton } from "./confirm"
import { CopyButton, CopyField } from "./copy"
import { Empty, StatusBadge, TableShell, THead, selectClass, tdClass, thClass } from "./ui"
import { useAction } from "./use-action"

export type LinkView = { id: number; url: string; landingPage: string; isDefault: boolean; status: string; campaign: string | null; stats: { clicks: number; signups: number; customers: number } }

// Builds a tagged link in the browser from the affiliate's own code — handy
// for one-off posts. It's the same link the server would build; the UTM tags
// are only labels for the affiliate's own analytics.
export function LinkBuilder({ base, code, token }: { base: string; code: string; token: string | null }) {
  const [landing, setLanding] = useState("/")
  const [utm, setUtm] = useState({ source: "", medium: "", campaign: "", content: "" })
  const url = useMemo(
    () => buildTrackingUrl({ base, code, landingPage: landing, linkToken: token, utm: { source: cleanUtm(utm.source), medium: cleanUtm(utm.medium), campaign: cleanUtm(utm.campaign), content: cleanUtm(utm.content) } }),
    [base, code, token, landing, utm]
  )
  const set = (k: keyof typeof utm) => (e: React.ChangeEvent<HTMLInputElement>) => setUtm((u) => ({ ...u, [k]: e.target.value }))
  return (
    <section className="rounded-xl border bg-card p-5">
      <h2 className="text-sm font-semibold">Link builder</h2>
      <p className="mt-0.5 text-xs text-muted-foreground">Pick a page and add UTM tags to label where you&apos;re posting it. The tags show up under Analytics → Traffic sources.</p>
      <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
        <label className="flex flex-col gap-1.5 text-xs text-muted-foreground">
          Landing page
          <select value={landing} onChange={(e) => setLanding(e.target.value)} className={selectClass}>
            {LANDING_PAGES.map((p) => (
              <option key={p.path} value={p.path}>
                {p.label}
              </option>
            ))}
          </select>
        </label>
        {(["source", "medium", "campaign", "content"] as const).map((k) => (
          <label key={k} className="flex flex-col gap-1.5 text-xs capitalize text-muted-foreground">
            UTM {k}
            <Input value={utm[k]} onChange={set(k)} maxLength={60} placeholder={{ source: "twitter", medium: "social", campaign: "launch", content: "bio" }[k]} />
          </label>
        ))}
      </div>
      <CopyField value={url} label="Built link" className="mt-4" />
    </section>
  )
}

export function LinksManager({ links, campaigns }: { links: LinkView[]; campaigns: { id: number; name: string }[] }) {
  const [open, setOpen] = useState(false)
  const [campaignId, setCampaignId] = useState("")
  const [landingPage, setLandingPage] = useState("/")
  const { pending, run } = useAction()

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm text-muted-foreground">Each link tracks its own clicks, sign-ups and customers.</p>
        <Button onClick={() => setOpen(true)}>
          <Plus className="size-4" aria-hidden /> New link
        </Button>
      </div>
      {links.length === 0 ? (
        <div className="rounded-xl border bg-card">
          <Empty icon={Link2} title="No links yet" />
        </div>
      ) : (
        <TableShell>
          <THead>
            <tr>
              <th className={thClass}>Link</th>
              <th className={thClass}>Campaign</th>
              <th className={thClass}>Status</th>
              <th className={`${thClass} text-end`}>Clicks</th>
              <th className={`${thClass} text-end`}>Sign-ups</th>
              <th className={`${thClass} text-end`}>Customers</th>
              <th className={`${thClass} text-end`}>Actions</th>
            </tr>
          </THead>
          <tbody className="divide-y">
            {links.map((l) => (
              <tr key={l.id}>
                <td className={tdClass}>
                  <p className="max-w-72 truncate font-mono text-xs" title={l.url}>
                    {l.url.replace(/^https?:\/\//, "")}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    {LANDING_PAGES.find((p) => p.path === l.landingPage)?.label ?? l.landingPage}
                    {l.isDefault && " · Main link"}
                  </p>
                </td>
                <td className={`${tdClass} text-muted-foreground`}>{l.campaign ?? "—"}</td>
                <td className={tdClass}>
                  <StatusBadge status={l.status} />
                </td>
                <td className={`${tdClass} text-end tabular-nums`}>{count(l.stats.clicks)}</td>
                <td className={`${tdClass} text-end tabular-nums`}>{count(l.stats.signups)}</td>
                <td className={`${tdClass} text-end tabular-nums`}>{count(l.stats.customers)}</td>
                <td className={tdClass}>
                  <div className="flex items-center justify-end gap-1.5">
                    <CopyButton value={l.url} />
                    {!l.isDefault &&
                      (l.status === "active" ? (
                        <ConfirmButton title="Disable this link?" description="Visits through it stop being counted and stop attributing sign-ups to you. You can enable it again later." confirmLabel="Disable" destructive action={() => changeLinkStatus(l.id, "disabled")}>
                          Disable
                        </ConfirmButton>
                      ) : (
                        <ConfirmButton title="Enable this link?" confirmLabel="Enable" action={() => changeLinkStatus(l.id, "active")}>
                          Enable
                        </ConfirmButton>
                      ))}
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </TableShell>
      )}

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="sm:max-w-md">
          <form
            className="grid gap-4"
            onSubmit={(e) => {
              e.preventDefault()
              run(() => addLink({ campaignId: campaignId ? Number(campaignId) : null, landingPage }), () => setOpen(false))
            }}
          >
            <DialogHeader>
              <DialogTitle>New tracking link</DialogTitle>
              <DialogDescription>A separate link with its own numbers — optionally counted under one of your campaigns.</DialogDescription>
            </DialogHeader>
            <label className="flex flex-col gap-1.5 text-xs text-muted-foreground">
              Landing page
              <select value={landingPage} onChange={(e) => setLandingPage(e.target.value)} className={selectClass}>
                {LANDING_PAGES.map((p) => (
                  <option key={p.path} value={p.path}>
                    {p.label}
                  </option>
                ))}
              </select>
            </label>
            <label className="flex flex-col gap-1.5 text-xs text-muted-foreground">
              Campaign
              <select value={campaignId} onChange={(e) => setCampaignId(e.target.value)} className={selectClass}>
                <option value="">No campaign</option>
                {campaigns.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </select>
            </label>
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setOpen(false)} disabled={pending}>
                Cancel
              </Button>
              <Button type="submit" disabled={pending}>
                {pending ? "Creating…" : "Create link"}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  )
}
