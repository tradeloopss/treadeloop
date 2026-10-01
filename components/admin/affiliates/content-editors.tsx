"use client"

import { useState } from "react"
import { Pencil, Plus } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Textarea } from "@/components/ui/textarea"
import { deleteAnnouncement, deleteResource, saveAnnouncement, saveResource } from "@/app/actions/admin-affiliates"
import { ANNOUNCEMENT_CATEGORIES, RESOURCE_CATEGORIES, RESOURCE_CATEGORY_LABELS } from "@/lib/affiliates/types"
import { ConfirmButton } from "@/components/affiliate/confirm"
import { Empty, StatusBadge, TableShell, THead, fmtDay, selectClass, tdClass, thClass } from "@/components/affiliate/ui"
import { useAction } from "@/components/affiliate/use-action"

const label = "flex flex-col gap-1.5 text-xs text-muted-foreground"

// --- Resources ----------------------------------------------------------------

export type ResourceRow = { id: number; title: string; description: string | null; category: string; url: string | null; previewUrl: string | null; content: string | null; published: boolean; sortOrder: number }
const BLANK_RESOURCE = { title: "", description: "", category: "brand", url: "", previewUrl: "", content: "", published: true, sortOrder: "0" }

export function ResourcesAdmin({ resources, canManage }: { resources: ResourceRow[]; canManage: boolean }) {
  const [open, setOpen] = useState(false)
  const [editing, setEditing] = useState<ResourceRow | null>(null)
  const [form, setForm] = useState(BLANK_RESOURCE)
  const { pending, run } = useAction()
  const set = (k: "title" | "description" | "category" | "url" | "previewUrl" | "content" | "sortOrder") => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) => setForm((f) => ({ ...f, [k]: e.target.value }))
  const openFor = (r: ResourceRow | null) => {
    setEditing(r)
    setForm(r ? { title: r.title, description: r.description ?? "", category: r.category, url: r.url ?? "", previewUrl: r.previewUrl ?? "", content: r.content ?? "", published: r.published, sortOrder: String(r.sortOrder) } : BLANK_RESOURCE)
    setOpen(true)
  }

  return (
    <div className="flex flex-col gap-4">
      {canManage && (
        <div className="flex justify-end">
          <Button onClick={() => openFor(null)}>
            <Plus className="size-4" aria-hidden /> New resource
          </Button>
        </div>
      )}
      {resources.length === 0 ? (
        <div className="rounded-xl border bg-card">
          <Empty title="No resources yet">Add logos, banners, screenshots (as links to the files) or ready-to-post copy for affiliates to use.</Empty>
        </div>
      ) : (
        <TableShell>
          <THead>
            <tr>
              <th className={thClass}>Resource</th>
              <th className={thClass}>Category</th>
              <th className={thClass}>Contains</th>
              <th className={thClass}>Status</th>
              <th className={`${thClass} text-end`}>Actions</th>
            </tr>
          </THead>
          <tbody className="divide-y">
            {resources.map((r) => (
              <tr key={r.id}>
                <td className={tdClass}>
                  <p className="font-medium">{r.title}</p>
                  {r.description && <p className="max-w-80 truncate text-xs text-muted-foreground">{r.description}</p>}
                </td>
                <td className={tdClass}>{RESOURCE_CATEGORY_LABELS[r.category] ?? r.category}</td>
                <td className={`${tdClass} text-muted-foreground`}>{[r.url && "File link", r.content && "Copy text"].filter(Boolean).join(" + ")}</td>
                <td className={tdClass}>
                  <StatusBadge status={r.published ? "active" : "disabled"} label={r.published ? "Published" : "Hidden"} />
                </td>
                <td className={tdClass}>
                  {canManage && (
                    <div className="flex justify-end gap-1.5">
                      <Button variant="outline" size="sm" onClick={() => openFor(r)}>
                        <Pencil className="size-3.5" aria-hidden /> Edit
                      </Button>
                      <ConfirmButton variant="destructive" destructive title={`Delete “${r.title}”?`} description="It disappears from every affiliate's Resources page." confirmLabel="Delete" action={() => deleteResource(r.id)}>
                        Delete
                      </ConfirmButton>
                    </div>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </TableShell>
      )}

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-h-[90svh] overflow-y-auto sm:max-w-lg">
          <form
            className="grid gap-4"
            onSubmit={(e) => {
              e.preventDefault()
              run(() => saveResource({ id: editing?.id ?? null, ...form, sortOrder: Number(form.sortOrder) || 0 }), () => setOpen(false))
            }}
          >
            <DialogHeader>
              <DialogTitle>{editing ? "Edit resource" : "New resource"}</DialogTitle>
              <DialogDescription>Give it a file link, some copy text, or both.</DialogDescription>
            </DialogHeader>
            <label className={label}>
              Title
              <Input value={form.title} onChange={set("title")} maxLength={100} required autoFocus />
            </label>
            <label className={label}>
              Description
              <Input value={form.description} onChange={set("description")} maxLength={300} />
            </label>
            <div className="grid gap-3 sm:grid-cols-2">
              <label className={label}>
                Category
                <select value={form.category} onChange={set("category")} className={selectClass}>
                  {RESOURCE_CATEGORIES.map((c) => (
                    <option key={c} value={c}>
                      {RESOURCE_CATEGORY_LABELS[c]}
                    </option>
                  ))}
                </select>
              </label>
              <label className={label}>
                Sort order
                <Input type="number" step={1} value={form.sortOrder} onChange={set("sortOrder")} />
              </label>
            </div>
            <label className={label}>
              File link (https://…)
              <Input value={form.url} onChange={set("url")} maxLength={500} placeholder="https://…/tradeloop-logos.zip" inputMode="url" />
            </label>
            <label className={label}>
              Preview image link (optional)
              <Input value={form.previewUrl} onChange={set("previewUrl")} maxLength={500} placeholder="https://…/preview.png" inputMode="url" />
            </label>
            <label className={label}>
              Copy text (optional)
              <Textarea value={form.content} onChange={set("content")} rows={5} maxLength={5000} placeholder="Write {link} where the affiliate's own referral link should go." />
            </label>
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" checked={form.published} onChange={(e) => setForm((f) => ({ ...f, published: e.target.checked }))} className="size-4 accent-[var(--primary)]" />
              Visible to affiliates
            </label>
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setOpen(false)} disabled={pending}>
                Cancel
              </Button>
              <Button type="submit" disabled={pending}>
                {pending ? "Saving…" : "Save resource"}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  )
}

// --- Announcements --------------------------------------------------------------

export type AnnouncementRow = { id: number; title: string; category: string; summary: string | null; content: string; published: boolean; publishedAt: string | null }
const BLANK_ANNOUNCEMENT = { title: "", category: "update", summary: "", content: "" }

export function AnnouncementsAdmin({ announcements, canManage }: { announcements: AnnouncementRow[]; canManage: boolean }) {
  const [open, setOpen] = useState(false)
  const [editing, setEditing] = useState<AnnouncementRow | null>(null)
  const [form, setForm] = useState(BLANK_ANNOUNCEMENT)
  const { pending, run } = useAction()
  const set = (k: keyof typeof BLANK_ANNOUNCEMENT) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) => setForm((f) => ({ ...f, [k]: e.target.value }))
  const openFor = (a: AnnouncementRow | null) => {
    setEditing(a)
    setForm(a ? { title: a.title, category: a.category, summary: a.summary ?? "", content: a.content } : BLANK_ANNOUNCEMENT)
    setOpen(true)
  }
  const submit = (published: boolean) => {
    if (published && !editing?.publishedAt && !window.confirm("Publish this to every active affiliate? They're notified in the portal and by email.")) return
    run(() => saveAnnouncement({ id: editing?.id ?? null, ...form, published }), () => setOpen(false))
  }

  return (
    <div className="flex flex-col gap-4">
      {canManage && (
        <div className="flex justify-end">
          <Button onClick={() => openFor(null)}>
            <Plus className="size-4" aria-hidden /> New announcement
          </Button>
        </div>
      )}
      {announcements.length === 0 ? (
        <div className="rounded-xl border bg-card">
          <Empty title="No announcements yet">Tell affiliates about promotions, product launches or changes to the program.</Empty>
        </div>
      ) : (
        <TableShell>
          <THead>
            <tr>
              <th className={thClass}>Announcement</th>
              <th className={thClass}>Category</th>
              <th className={thClass}>Status</th>
              <th className={thClass}>Published</th>
              <th className={`${thClass} text-end`}>Actions</th>
            </tr>
          </THead>
          <tbody className="divide-y">
            {announcements.map((a) => (
              <tr key={a.id}>
                <td className={tdClass}>
                  <p className="font-medium">{a.title}</p>
                  {a.summary && <p className="max-w-96 truncate text-xs text-muted-foreground">{a.summary}</p>}
                </td>
                <td className={`${tdClass} capitalize`}>{a.category}</td>
                <td className={tdClass}>
                  <StatusBadge status={a.published ? "active" : "disabled"} label={a.published ? "Live" : a.publishedAt ? "Unpublished" : "Draft"} />
                </td>
                <td className={`${tdClass} whitespace-nowrap text-muted-foreground`}>{fmtDay(a.publishedAt)}</td>
                <td className={tdClass}>
                  {canManage && (
                    <div className="flex justify-end gap-1.5">
                      <Button variant="outline" size="sm" onClick={() => openFor(a)}>
                        <Pencil className="size-3.5" aria-hidden /> Edit
                      </Button>
                      <ConfirmButton variant="destructive" destructive title={`Delete “${a.title}”?`} description="It's removed from every affiliate's Announcements page." confirmLabel="Delete" action={() => deleteAnnouncement(a.id)}>
                        Delete
                      </ConfirmButton>
                    </div>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </TableShell>
      )}

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-h-[90svh] overflow-y-auto sm:max-w-lg">
          <form
            className="grid gap-4"
            onSubmit={(e) => {
              e.preventDefault()
              submit(true)
            }}
          >
            <DialogHeader>
              <DialogTitle>{editing ? "Edit announcement" : "New announcement"}</DialogTitle>
              <DialogDescription>{editing?.publishedAt ? "Already announced — saving updates the text without notifying again." : "Publishing notifies every active affiliate once."}</DialogDescription>
            </DialogHeader>
            <label className={label}>
              Title
              <Input value={form.title} onChange={set("title")} maxLength={120} required autoFocus />
            </label>
            <label className={label}>
              Category
              <select value={form.category} onChange={set("category")} className={selectClass}>
                {ANNOUNCEMENT_CATEGORIES.map((c) => (
                  <option key={c} value={c}>
                    {c.charAt(0).toUpperCase() + c.slice(1)}
                  </option>
                ))}
              </select>
            </label>
            <label className={label}>
              Summary (shown in the list and the email)
              <Input value={form.summary} onChange={set("summary")} maxLength={240} />
            </label>
            <label className={label}>
              Full text
              <Textarea value={form.content} onChange={set("content")} rows={8} maxLength={8000} required />
            </label>
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => submit(false)} disabled={pending || form.title.trim().length < 3 || form.content.trim().length < 10}>
                {editing?.published ? "Unpublish" : "Save as draft"}
              </Button>
              <Button type="submit" disabled={pending}>
                {pending ? "Saving…" : editing?.published ? "Save changes" : "Publish"}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  )
}
