"use client"

import { useState, useTransition } from "react"
import { toast } from "sonner"
import { Pencil, Plus, Trash2 } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Textarea } from "@/components/ui/textarea"
import { deleteStarterPlaybook, deleteStarterTagGroup, disableShare, saveStarterPlaybook, saveStarterTagGroup, type ActionResult } from "@/app/actions/admin"

const COLORS = ["violet", "blue", "green", "amber", "rose", "slate"]

function useAction() {
  const [pending, startTransition] = useTransition()
  const perform = (action: () => Promise<ActionResult>, success: string, onSuccess?: () => void) =>
    startTransition(async () => {
      const result = await action()
      if (result.ok) {
        toast.success(result.message ?? success)
        onSuccess?.()
      } else toast.error(result.error)
    })
  return { pending, perform }
}

const linesToList = (text: string) => text.split(/\r?\n|,/).map((s) => s.trim()).filter(Boolean)

export type StarterGroup = { id: number; name: string; color: string; options: string[] }
export type StarterBook = { id: number; name: string; description: string | null; rules: string[] }

export function TagGroupEditor({ groups }: { groups: StarterGroup[] }) {
  const { pending, perform } = useAction()
  const [editing, setEditing] = useState<StarterGroup | { id: null } | null>(null)
  const [name, setName] = useState("")
  const [color, setColor] = useState("violet")
  const [options, setOptions] = useState("")

  function open(group: StarterGroup | null) {
    setEditing(group ?? { id: null })
    setName(group?.name ?? "")
    setColor(group?.color ?? "violet")
    setOptions(group?.options.join("\n") ?? "")
  }

  return (
    <div className="space-y-3">
      <ul className="divide-y">
        {groups.map((g) => (
          <li key={g.id} className="flex items-start justify-between gap-3 py-2.5">
            <div className="min-w-0">
              <p className="text-sm font-medium">
                <span className={`mr-2 inline-block size-2.5 rounded-full bg-${g.color}-500`} aria-hidden="true" />
                {g.name}
              </p>
              <p className="mt-0.5 flex flex-wrap gap-1">
                {g.options.map((o) => (
                  <span key={o} className="rounded-full bg-muted px-2 py-0.5 text-xs">{o}</span>
                ))}
                {g.options.length === 0 && <span className="text-xs text-muted-foreground">No tags yet</span>}
              </p>
            </div>
            <div className="flex shrink-0 gap-1">
              <Button size="sm" variant="ghost" onClick={() => open(g)} aria-label={`Edit ${g.name}`}><Pencil className="size-3.5" /></Button>
              <Button
                size="sm"
                variant="ghost"
                disabled={pending}
                aria-label={`Delete ${g.name}`}
                onClick={() => {
                  if (confirm(`Remove "${g.name}" from the starter set? Users who already have it keep it.`)) perform(() => deleteStarterTagGroup(g.id), "Removed.")
                }}
              >
                <Trash2 className="size-3.5" />
              </Button>
            </div>
          </li>
        ))}
        {groups.length === 0 && <li className="py-6 text-center text-sm text-muted-foreground">New users start with no tags. Add a group to change that.</li>}
      </ul>

      {editing ? (
        <form
          className="space-y-3 rounded-lg border bg-muted/30 p-4"
          onSubmit={(e) => {
            e.preventDefault()
            perform(() => saveStarterTagGroup({ id: editing.id, name, color, options: linesToList(options) }), "Saved.", () => setEditing(null))
          }}
        >
          <div className="flex flex-wrap gap-3">
            <label className="flex min-w-48 flex-1 flex-col gap-1 text-xs text-muted-foreground">
              Group name
              <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Setup" maxLength={60} required className="h-9" />
            </label>
            <label className="flex flex-col gap-1 text-xs text-muted-foreground">
              Colour
              <select value={color} onChange={(e) => setColor(e.target.value)} className="h-9 rounded-lg border border-input bg-background px-2.5 text-sm text-foreground capitalize">
                {COLORS.map((c) => (
                  <option key={c} value={c}>{c}</option>
                ))}
              </select>
            </label>
          </div>
          <label className="flex flex-col gap-1 text-xs text-muted-foreground">
            Tags in this group — one per line
            <Textarea value={options} onChange={(e) => setOptions(e.target.value)} rows={5} placeholder={"Breakout\nPullback\nReversal"} />
          </label>
          <div className="flex gap-2">
            <Button type="submit" size="sm" disabled={pending}>{editing.id ? "Save group" : "Add group"}</Button>
            <Button type="button" size="sm" variant="ghost" onClick={() => setEditing(null)}>Cancel</Button>
          </div>
        </form>
      ) : (
        <Button size="sm" variant="outline" onClick={() => open(null)}><Plus className="size-3.5" /> Add tag group</Button>
      )}
    </div>
  )
}

export function PlaybookEditor({ books }: { books: StarterBook[] }) {
  const { pending, perform } = useAction()
  const [editing, setEditing] = useState<StarterBook | { id: null } | null>(null)
  const [name, setName] = useState("")
  const [description, setDescription] = useState("")
  const [rules, setRules] = useState("")

  function open(book: StarterBook | null) {
    setEditing(book ?? { id: null })
    setName(book?.name ?? "")
    setDescription(book?.description ?? "")
    setRules(book?.rules.join("\n") ?? "")
  }

  return (
    <div className="space-y-3">
      <ul className="divide-y">
        {books.map((b) => (
          <li key={b.id} className="flex items-start justify-between gap-3 py-2.5">
            <div className="min-w-0">
              <p className="text-sm font-medium">{b.name}</p>
              {b.description && <p className="text-xs text-muted-foreground">{b.description}</p>}
              <p className="mt-0.5 text-xs text-muted-foreground">{b.rules.length} rule{b.rules.length === 1 ? "" : "s"}</p>
            </div>
            <div className="flex shrink-0 gap-1">
              <Button size="sm" variant="ghost" onClick={() => open(b)} aria-label={`Edit ${b.name}`}><Pencil className="size-3.5" /></Button>
              <Button
                size="sm"
                variant="ghost"
                disabled={pending}
                aria-label={`Delete ${b.name}`}
                onClick={() => {
                  if (confirm(`Remove "${b.name}" from the starter set? Users who already have it keep it.`)) perform(() => deleteStarterPlaybook(b.id), "Removed.")
                }}
              >
                <Trash2 className="size-3.5" />
              </Button>
            </div>
          </li>
        ))}
        {books.length === 0 && <li className="py-6 text-center text-sm text-muted-foreground">New users start with no playbooks. Add one to change that.</li>}
      </ul>

      {editing ? (
        <form
          className="space-y-3 rounded-lg border bg-muted/30 p-4"
          onSubmit={(e) => {
            e.preventDefault()
            perform(() => saveStarterPlaybook({ id: editing.id, name, description, rules: linesToList(rules) }), "Saved.", () => setEditing(null))
          }}
        >
          <label className="flex flex-col gap-1 text-xs text-muted-foreground">
            Playbook name
            <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Opening Range Breakout" maxLength={80} required className="h-9" />
          </label>
          <label className="flex flex-col gap-1 text-xs text-muted-foreground">
            Description (optional)
            <Input value={description} onChange={(e) => setDescription(e.target.value)} maxLength={500} className="h-9" />
          </label>
          <label className="flex flex-col gap-1 text-xs text-muted-foreground">
            Rules — one per line
            <Textarea value={rules} onChange={(e) => setRules(e.target.value)} rows={5} placeholder={"Wait for the first 15-minute range to form\nEnter on a close outside the range\nStop at the opposite side of the range"} />
          </label>
          <div className="flex gap-2">
            <Button type="submit" size="sm" disabled={pending}>{editing.id ? "Save playbook" : "Add playbook"}</Button>
            <Button type="button" size="sm" variant="ghost" onClick={() => setEditing(null)}>Cancel</Button>
          </div>
        </form>
      ) : (
        <Button size="sm" variant="outline" onClick={() => open(null)}><Plus className="size-3.5" /> Add playbook</Button>
      )}
    </div>
  )
}

export function DisableShareButton({ kind, id }: { kind: "playbook" | "trade" | "daily" | "payout"; id: number }) {
  const { pending, perform } = useAction()
  return (
    <Button
      size="sm"
      variant="outline"
      disabled={pending}
      onClick={() => {
        if (confirm("Disable this public link? The owner can create a new one.")) perform(() => disableShare(kind, id), "Link disabled.")
      }}
    >
      Disable link
    </Button>
  )
}
