"use client"

import { Fragment, useEffect, useState } from "react"
import { useRouter, useSearchParams } from "next/navigation"
import { createTemplate, updateTemplate } from "@/app/actions/dashboard-templates"
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
import { Card } from "@/components/ui/card"
import { ChevronLeft, ChevronRight, GripVertical, Plus, X } from "lucide-react"
import { toast } from "sonner"
import { useT } from "@/components/locale-provider"

// Tailwind needs the whole class name at build time, so column counts are
// looked up rather than interpolated.
const STAT_GRID_COLS: Record<number, string> = {
  1: "lg:grid-cols-1",
  2: "lg:grid-cols-2",
  3: "lg:grid-cols-3",
  4: "lg:grid-cols-4",
  5: "lg:grid-cols-5",
}

const PANEL_SPAN: Record<number, string> = {
  1: "lg:col-span-1",
  2: "lg:col-span-2",
  3: "lg:col-span-3",
}

export function DashboardCanvas({
  template,
  statNodes,
  panelNodes,
}: {
  template: DashboardTemplate
  statNodes: Record<string, React.ReactNode>
  panelNodes: Record<string, React.ReactNode>
}) {
  const router = useRouter()
  const t = useT()
  const searchParams = useSearchParams()
  const editing = searchParams.get("edit") === "1"

  const [stats, setStats] = useState(template.statWidgets)
  const [panels, setPanels] = useState(template.panelWidgets)
  const [dragging, setDragging] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)

  // A save, a template switch or a cancel all re-render with fresh server data;
  // the local draft follows it rather than holding a stale layout.
  useEffect(() => {
    setStats(template.statWidgets)
    setPanels(template.panelWidgets)
  }, [template.id, template.statWidgets, template.panelWidgets])

  const dirty =
    stats.join() !== template.statWidgets.join() || panels.join() !== template.panelWidgets.join()
  const isBuiltIn = template.id === DEFAULT_TEMPLATE.id

  function leaveEditMode() {
    router.replace("/dashboard")
  }

  function cancel() {
    setStats(template.statWidgets)
    setPanels(template.panelWidgets)
    leaveEditMode()
  }

  async function save() {
    setSaving(true)
    try {
      // The built-in layout has no row to write to, so saving edits to it
      // creates the trader's own template instead of silently discarding them.
      if (isBuiltIn) {
        await createTemplate(t("My layout"), stats, panels)
        toast.success(t("Saved as a new template, “{name}”", { name: t("My layout") }))
      } else {
        await updateTemplate(template.id, template.name, stats, panels)
        toast.success(t("Saved {name}", { name: template.name }))
      }
      router.replace("/dashboard")
      router.refresh()
    } catch (error) {
      toast.error(error instanceof Error ? t(error.message) : t("Could not save the layout"))
    } finally {
      setSaving(false)
    }
  }

  function reorder(ids: string[], setIds: (next: string[]) => void, targetId: string) {
    if (!dragging || dragging === targetId || !ids.includes(dragging)) return
    const next = ids.filter((id) => id !== dragging)
    next.splice(ids.indexOf(targetId), 0, dragging)
    setIds(next)
    setDragging(null)
  }

  function move(ids: string[], setIds: (next: string[]) => void, id: string, delta: number) {
    const from = ids.indexOf(id)
    const to = from + delta
    if (to < 0 || to >= ids.length) return
    const next = [...ids]
    next.splice(to, 0, ...next.splice(from, 1))
    setIds(next)
  }

  function widgetShell(
    id: string,
    node: React.ReactNode,
    ids: string[],
    setIds: (next: string[]) => void,
    index: number,
  ) {
    const widget = WIDGET_BY_ID[id]
    if (!widget || node == null) return null
    // Outside edit mode the widget is the grid item itself — an extra wrapper
    // would stop the h-full cards stretching to the row height.
    if (!editing) return node

    return (
      <div
        draggable
        onDragStart={() => setDragging(id)}
        onDragEnd={() => setDragging(null)}
        onDragOver={(e) => e.preventDefault()}
        onDrop={() => reorder(ids, setIds, id)}
        className={cn(
          "relative h-full rounded-xl ring-2 ring-dashed ring-primary/40 transition-opacity",
          dragging === id && "opacity-40",
        )}
      >
        <div className="absolute -top-3 start-3 z-10 flex items-center gap-0.5 rounded-md border bg-background px-1 py-0.5 shadow-sm">
          <GripVertical className="size-3.5 cursor-grab text-muted-foreground" />
          <span className="pe-1 text-[11px] font-medium">{t(widget.label)}</span>
          {/* Drag is the quick path; the arrows keep reordering usable on touch
              and with a keyboard, where HTML5 drag events never fire. */}
          <button
            type="button"
            aria-label={t("Move {name} earlier", { name: t(widget.label) })}
            disabled={index === 0}
            onClick={() => move(ids, setIds, id, -1)}
            className="rounded p-0.5 text-muted-foreground hover:bg-accent disabled:opacity-30"
          >
            <ChevronLeft className="size-3.5" />
          </button>
          <button
            type="button"
            aria-label={t("Move {name} later", { name: t(widget.label) })}
            disabled={index === ids.length - 1}
            onClick={() => move(ids, setIds, id, 1)}
            className="rounded p-0.5 text-muted-foreground hover:bg-accent disabled:opacity-30"
          >
            <ChevronRight className="size-3.5" />
          </button>
          <button
            type="button"
            aria-label={t("Remove {name}", { name: t(widget.label) })}
            onClick={() => setIds(ids.filter((w) => w !== id))}
            className="rounded p-0.5 text-[var(--loss)] hover:bg-accent"
          >
            <X className="size-3.5" />
          </button>
        </div>
        <div className="pointer-events-none select-none">{node}</div>
      </div>
    )
  }

  return (
    <div className="space-y-6">
      {editing && (
        <div className="sticky top-2 z-30 flex flex-wrap items-center gap-3 rounded-lg border bg-background/95 p-3 shadow-sm backdrop-blur">
          <div className="min-w-0 flex-1">
            <p className="text-sm font-medium">
              {isBuiltIn ? t("Editing the default layout") : t("Editing {name}", { name: template.name })}
            </p>
            <p className="text-xs text-muted-foreground">
              {t("Drag widgets to rearrange, remove them with ×, or add more below.")}
              {isBuiltIn && " " + t("Saving creates your own template.")}
            </p>
          </div>
          <Button variant="outline" onClick={cancel} disabled={saving}>
            {t("Cancel")}
          </Button>
          <Button onClick={save} disabled={saving || !dirty}>
            {saving ? t("Saving…") : t("Save")}
          </Button>
        </div>
      )}

      {stats.length > 0 && (
        <div className={cn("grid gap-4 sm:grid-cols-2", STAT_GRID_COLS[stats.length] ?? "lg:grid-cols-5")}>
          {stats.map((id, i) => (
            <Fragment key={id}>{widgetShell(id, statNodes[id], stats, setStats, i)}</Fragment>
          ))}
        </div>
      )}

      {editing && (
        <AddWidgets
          title={t("Top row")}
          catalogue={STAT_WIDGETS}
          selected={stats}
          max={MAX_STAT_WIDGETS}
          onAdd={(id) => setStats([...stats, id])}
        />
      )}

      {panels.length > 0 && (
        <div className="grid items-stretch gap-4 lg:grid-cols-3">
          {panels.map((id, i) => (
            <div key={id} className={PANEL_SPAN[WIDGET_BY_ID[id]?.span ?? 1]}>
              {widgetShell(id, panelNodes[id], panels, setPanels, i)}
            </div>
          ))}
        </div>
      )}

      {editing && (
        <AddWidgets title={t("Lower section")} catalogue={PANEL_WIDGETS} selected={panels} onAdd={(id) => setPanels([...panels, id])} />
      )}

      {!editing && stats.length === 0 && panels.length === 0 && (
        <Card className="flex h-40 flex-col items-center justify-center gap-2 text-center">
          <p className="text-sm text-muted-foreground">
            {t("This template has no widgets. Open")} <span className="font-medium">{t("Template")}</span> {t("above to add some.")}
          </p>
        </Card>
      )}
    </div>
  )
}

function AddWidgets({
  title,
  catalogue,
  selected,
  max,
  onAdd,
}: {
  title: string
  catalogue: WidgetDef[]
  selected: string[]
  max?: number
  onAdd: (id: string) => void
}) {
  const t = useT()
  const available = catalogue.filter((w) => !selected.includes(w.id))
  const full = max != null && selected.length >= max

  return (
    <div className="rounded-lg border border-dashed p-3">
      <p className="mb-2 text-xs font-medium text-muted-foreground">
        {t("Add to {section}", { section: title })}
        {max != null && ` · ${t("{used}/{max} used", { used: selected.length, max })}`}
      </p>
      {available.length === 0 ? (
        <p className="text-xs text-muted-foreground">{t("Every widget in this section is already on the dashboard.")}</p>
      ) : (
        <div className="flex flex-wrap gap-1.5">
          {available.map((widget) => (
            <Button
              key={widget.id}
              variant="outline"
              size="sm"
              disabled={full}
              title={full ? t("The top row holds at most {max} widgets", { max: max ?? 0 }) : t(widget.description)}
              onClick={() => onAdd(widget.id)}
            >
              <Plus className="size-3.5" />
              {t(widget.label)}
            </Button>
          ))}
        </div>
      )}
    </div>
  )
}
