"use client"

import { useState } from "react"
import Link from "next/link"
import { useRouter } from "next/navigation"
import {
  activateTemplate,
  createTemplate,
  deleteTemplate,
  updateTemplate,
  selectDefaultTemplate,
} from "@/app/actions/dashboard-templates"
import {
  DEFAULT_TEMPLATE,
  MAX_STAT_WIDGETS,
  PANEL_WIDGETS,
  STAT_WIDGETS,
  WIDGET_BY_ID,
  type DashboardTemplate,
  type WidgetDef,
} from "@/lib/dashboard-widgets"
import { cn } from "@/lib/utils"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
} from "@/components/ui/dropdown-menu"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { ChevronDown, ChevronUp, Check, GripVertical, LayoutGrid, Move, Pencil, Plus, Trash2, X } from "lucide-react"
import { toast } from "sonner"

type Draft = {
  id: number | null
  name: string
  stats: string[]
  panels: string[]
}

export function DashboardTemplateMenu({
  templates,
  active,
}: {
  templates: DashboardTemplate[]
  active: DashboardTemplate
}) {
  const router = useRouter()
  const [draft, setDraft] = useState<Draft | null>(null)
  const [busy, setBusy] = useState(false)

  function openEditor(template: DashboardTemplate | null) {
    setDraft(
      template
        ? {
            // The built-in layout has no row to update, so editing it starts a
            // new, unnamed template seeded with its widgets.
            id: template.id || null,
            name: template.id ? template.name : "",
            stats: [...template.statWidgets],
            panels: [...template.panelWidgets],
          }
        : {
            id: null,
            name: "",
            stats: [...active.statWidgets],
            panels: [...active.panelWidgets],
          },
    )
  }

  async function run(fn: () => Promise<unknown>, success: string) {
    setBusy(true)
    try {
      await fn()
      toast.success(success)
      router.refresh()
      return true
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Something went wrong")
      return false
    } finally {
      setBusy(false)
    }
  }

  async function onSave() {
    if (!draft) return
    const ok = await run(
      () =>
        draft.id
          ? updateTemplate(draft.id, draft.name, draft.stats, draft.panels)
          : createTemplate(draft.name || "My template", draft.stats, draft.panels),
      draft.id ? "Template saved" : "Template created",
    )
    if (ok) setDraft(null)
  }

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger
          render={
            <Button variant="outline">
              <LayoutGrid className="size-4" />
              Template
              <ChevronDown className="size-4 opacity-60" />
            </Button>
          }
        />
        <DropdownMenuContent align="end" className="w-72">
          {/* GroupLabel is only valid inside a Group, so the label and the rows
              it names live in one. */}
          <DropdownMenuGroup>
            <DropdownMenuLabel>Dashboard templates</DropdownMenuLabel>

            {/* The built-in layout is a selectable option, so a trader who saves
                templates can always get back to it. Its pencil opens the editor
                pre-filled with the default widgets, saving as a new template —
                the built-in layout itself isn't editable or deletable. */}
            <div className="flex items-center gap-1 px-1 py-0.5">
              <button
                type="button"
                disabled={busy}
                onClick={() => {
                  if (active.id !== DEFAULT_TEMPLATE.id) {
                    void run(() => selectDefaultTemplate(), "Switched to the default layout")
                  }
                }}
                className={cn(
                  "flex min-w-0 flex-1 items-center gap-2 rounded-sm px-2 py-1.5 text-left text-sm hover:bg-accent",
                  active.id === DEFAULT_TEMPLATE.id && "font-medium"
                )}
              >
                <Check className={cn("size-4 shrink-0", active.id === DEFAULT_TEMPLATE.id ? "opacity-100" : "opacity-0")} />
                <span className="truncate">{DEFAULT_TEMPLATE.name}</span>
                <span className="ml-auto shrink-0 text-xs text-muted-foreground">Built-in</span>
              </button>
              <Button
                variant="ghost"
                size="icon"
                aria-label="Create a template from the default layout"
                onClick={() => openEditor(DEFAULT_TEMPLATE)}
              >
                <Pencil className="size-3.5" />
              </Button>
            </div>

            {templates.map((template) => (
              <div key={template.id} className="flex items-center gap-1 px-1 py-0.5">
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => {
                    if (!template.isActive)
                      void run(() => activateTemplate(template.id), `Switched to ${template.name}`)
                  }}
                  className={cn(
                    "flex min-w-0 flex-1 items-center gap-2 rounded-sm px-2 py-1.5 text-left text-sm hover:bg-accent",
                    template.isActive && "font-medium",
                  )}
                >
                  <Check className={cn("size-4 shrink-0", template.isActive ? "opacity-100" : "opacity-0")} />
                  <span className="truncate">{template.name}</span>
                </button>
                <Button
                  variant="ghost"
                  size="icon"
                  aria-label={`Edit ${template.name}`}
                  onClick={() => openEditor(template)}
                >
                  <Pencil className="size-3.5" />
                </Button>
                <Button
                  variant="ghost"
                  size="icon"
                  aria-label={`Delete ${template.name}`}
                  disabled={busy}
                  onClick={() => void run(() => deleteTemplate(template.id), `Deleted ${template.name}`)}
                >
                  <Trash2 className="size-3.5 text-[var(--loss)]" />
                </Button>
              </div>
            ))}
          </DropdownMenuGroup>

          <DropdownMenuSeparator />
          {/* Edit mode lives in the URL so the dashboard (a server component)
              renders straight into it, rather than the header and the grid
              having to share client state. */}
          <DropdownMenuItem render={<Link href="/dashboard?edit=1" />}>
            <Move className="size-4" />
            Edit layout on the dashboard
          </DropdownMenuItem>
          <DropdownMenuItem onClick={() => openEditor(active)}>
            <Pencil className="size-4" />
            Edit in a list
          </DropdownMenuItem>
          <DropdownMenuItem onClick={() => openEditor(null)}>
            <Plus className="size-4" />
            Create New Template
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      <Dialog open={draft != null} onOpenChange={(open) => !open && setDraft(null)}>
        <DialogContent className="max-h-[88vh] overflow-y-auto sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle>{draft?.id ? "Edit template" : "Create new template"}</DialogTitle>
            <DialogDescription>Add, remove or rearrange widgets to fit your preferences, then save.</DialogDescription>
          </DialogHeader>

          {draft && (
            <div className="space-y-6">
              <div className="space-y-2">
                <Label htmlFor="template-name">Template name</Label>
                <Input
                  id="template-name"
                  value={draft.name}
                  placeholder="e.g. Risk review"
                  maxLength={60}
                  onChange={(e) => setDraft({ ...draft, name: e.target.value })}
                />
              </div>

              <WidgetSection
                title="Top row"
                hint={`Key metrics — up to ${MAX_STAT_WIDGETS} widgets`}
                catalogue={STAT_WIDGETS}
                selected={draft.stats}
                max={MAX_STAT_WIDGETS}
                onChange={(stats) => setDraft({ ...draft, stats })}
              />

              <WidgetSection
                title="Lower section"
                hint="Charts and detailed insights — no limit"
                catalogue={PANEL_WIDGETS}
                selected={draft.panels}
                onChange={(panels) => setDraft({ ...draft, panels })}
              />
            </div>
          )}

          <DialogFooter>
            <Button variant="outline" onClick={() => setDraft(null)} disabled={busy}>
              Cancel
            </Button>
            <Button onClick={onSave} disabled={busy}>
              {busy ? "Saving…" : "Save"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  )
}

function WidgetSection({
  title,
  hint,
  catalogue,
  selected,
  max,
  onChange,
}: {
  title: string
  hint: string
  catalogue: WidgetDef[]
  selected: string[]
  max?: number
  onChange: (ids: string[]) => void
}) {
  const [dragging, setDragging] = useState<string | null>(null)
  const available = catalogue.filter((w) => !selected.includes(w.id))
  const full = max != null && selected.length >= max

  function move(id: string, delta: number) {
    const from = selected.indexOf(id)
    const to = from + delta
    if (to < 0 || to >= selected.length) return
    const next = [...selected]
    next.splice(to, 0, ...next.splice(from, 1))
    onChange(next)
  }

  function dropOn(targetId: string) {
    if (!dragging || dragging === targetId) return
    const next = selected.filter((id) => id !== dragging)
    next.splice(selected.indexOf(targetId), 0, dragging)
    onChange(next)
    setDragging(null)
  }

  return (
    <div className="space-y-3">
      <div>
        <h3 className="text-sm font-medium">{title}</h3>
        <p className="text-xs text-muted-foreground">
          {hint}
          {max != null && ` · ${selected.length}/${max} used`}
        </p>
      </div>

      {selected.length === 0 ? (
        <p className="rounded-md border border-dashed p-3 text-xs text-muted-foreground">
          No widgets in this section yet — add one below.
        </p>
      ) : (
        <ul className="space-y-1.5">
          {selected.map((id, i) => {
            const widget = WIDGET_BY_ID[id]
            if (!widget) return null
            return (
              <li
                key={id}
                draggable
                onDragStart={() => setDragging(id)}
                onDragEnd={() => setDragging(null)}
                onDragOver={(e) => e.preventDefault()}
                onDrop={() => dropOn(id)}
                className={cn(
                  "flex items-center gap-2 rounded-md border bg-card px-2.5 py-2",
                  dragging === id && "opacity-50",
                )}
              >
                <GripVertical className="size-4 shrink-0 cursor-grab text-muted-foreground" />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium">{widget.label}</p>
                  <p className="truncate text-xs text-muted-foreground">{widget.description}</p>
                </div>
                {/* Drag is the quick path; the arrows keep reordering possible
                    with a keyboard or on touch, where HTML5 drag doesn't fire. */}
                <Button
                  variant="ghost"
                  size="icon"
                  aria-label="Move up"
                  disabled={i === 0}
                  onClick={() => move(id, -1)}
                >
                  <ChevronUp className="size-3.5" />
                </Button>
                <Button
                  variant="ghost"
                  size="icon"
                  aria-label="Move down"
                  disabled={i === selected.length - 1}
                  onClick={() => move(id, 1)}
                >
                  <ChevronDown className="size-3.5" />
                </Button>
                <Button
                  variant="ghost"
                  size="icon"
                  aria-label={`Remove ${widget.label}`}
                  onClick={() => onChange(selected.filter((w) => w !== id))}
                >
                  <X className="size-3.5" />
                </Button>
              </li>
            )
          })}
        </ul>
      )}

      {available.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {available.map((widget) => (
            <Button
              key={widget.id}
              variant="outline"
              size="sm"
              disabled={full}
              title={full ? `The top row holds at most ${max} widgets` : widget.description}
              onClick={() => onChange([...selected, widget.id])}
            >
              <Plus className="size-3.5" />
              {widget.label}
            </Button>
          ))}
        </div>
      )}
    </div>
  )
}
