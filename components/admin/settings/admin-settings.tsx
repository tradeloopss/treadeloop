"use client"

import { useState, useTransition } from "react"
import Link from "next/link"
import { useRouter } from "next/navigation"
import { toast } from "sonner"
import { ArrowLeftRight, ArrowUpRight, Bell, Check, LayoutDashboard, Palette, PanelLeft, PanelLeftClose, ScrollText, ShieldCheck, Sparkles, Users } from "lucide-react"
import { saveAdminSettings } from "@/app/actions/admin-shell"
import { NOTICE_CATEGORIES, type NoticeCategory } from "@/lib/admin/command-center-rules"
import type { AdminPrefs, DashboardVersion } from "@/lib/admin/preferences"
import { Button } from "@/components/ui/button"
import { ReturnToOldDialog, useDashboardSwitch } from "@/components/admin/shell/dashboard-switch"
import { ThemeChoice } from "@/components/admin/shell/theme-toggle"
import { cn } from "@/lib/utils"

export type SettingsSection = "dashboard" | "appearance" | "notifications"
type Saved = Pick<AdminPrefs, "dashboard" | "sidebar" | "notify">

const SECTIONS: { key: SettingsSection; label: string; icon: React.ElementType }[] = [
  { key: "dashboard", label: "Dashboard", icon: LayoutDashboard },
  { key: "appearance", label: "Appearance", icon: Palette },
  { key: "notifications", label: "Notifications", icon: Bell },
]

// Admin Settings: each admin's own choices for the admin area. Saved with
// their account (not the browser), except the theme, which TradeLoop keeps per
// browser everywhere. Security, team and audit settings already have their
// own pages; this links to them rather than copying them.
export function AdminSettings({ initial, section: initialSection, links }: { initial: Saved; section: SettingsSection; links: { security: boolean; team: boolean; audit: boolean } }) {
  const router = useRouter()
  const [section, setSection] = useState<SettingsSection>(initialSection)
  const [saved, setSaved] = useState<Saved>(initial)
  const [draft, setDraft] = useState<Saved>(initial)
  const [saving, start] = useTransition()
  const [confirmOld, setConfirmOld] = useState(false)
  const { switchTo, pending: switching } = useDashboardSwitch()

  const dirty = draft.dashboard !== saved.dashboard || draft.sidebar !== saved.sidebar || NOTICE_CATEGORIES.some((c) => draft.notify[c.key] !== saved.notify[c.key])

  const save = () =>
    start(async () => {
      try {
        const next = await saveAdminSettings({ dashboard: draft.dashboard, sidebar: draft.sidebar, notify: draft.notify })
        const kept = { dashboard: next.dashboard, sidebar: next.sidebar, notify: next.notify }
        setSaved(kept)
        setDraft(kept)
        router.refresh()
        if (saved.dashboard !== next.dashboard && next.dashboard === "legacy") {
          toast("Switched to the old dashboard.", { action: { label: "Return to new dashboard", onClick: () => switchTo("modern", () => setSaved((s) => ({ ...s, dashboard: "modern" }))) }, duration: 8000 })
        } else {
          toast.success("Settings saved.")
        }
      } catch {
        toast.error("Couldn't save your settings. Try again.")
      }
    })

  // Choosing the old dashboard asks first, whichever way it's done.
  const onSave = () => (draft.dashboard === "legacy" && saved.dashboard !== "legacy" ? setConfirmOld(true) : save())

  return (
    <div className="mx-auto w-full max-w-5xl px-4 pt-5 pb-28 sm:px-6 sm:pt-7 md:pb-10">
      <h1 className="text-2xl font-semibold tracking-tight sm:text-[28px]">Admin settings</h1>
      <p className="mt-1 text-sm text-muted-foreground">Your own preferences for the admin area. They follow your account to any device.</p>

      <div className="mt-6 grid gap-5 md:grid-cols-[220px_minmax(0,1fr)] md:gap-6">
        <nav aria-label="Settings sections" className="-mx-4 flex gap-1 overflow-x-auto px-4 pb-1 md:mx-0 md:flex-col md:overflow-visible md:px-0 [scrollbar-width:none]">
          {SECTIONS.map((s) => (
            <button
              key={s.key}
              type="button"
              onClick={() => setSection(s.key)}
              aria-current={section === s.key ? "true" : undefined}
              className={cn(
                "flex h-10 shrink-0 items-center gap-2.5 rounded-lg px-3 text-sm transition-colors focus-visible:ring-2 focus-visible:ring-ring/50 focus-visible:outline-none",
                section === s.key ? "bg-primary/10 font-semibold text-primary dark:bg-primary/15" : "text-muted-foreground hover:bg-muted hover:text-foreground"
              )}
            >
              <s.icon className="size-4" aria-hidden /> {s.label}
            </button>
          ))}
          <div className="mx-2 hidden h-px bg-border md:my-2 md:block" aria-hidden />
          {links.security && <PageLink href="/admin/security" icon={ShieldCheck} label="Security" />}
          {links.team && <PageLink href="/admin/team" icon={Users} label="Team & roles" />}
          {links.audit && <PageLink href="/admin/audit" icon={ScrollText} label="Audit log" />}
        </nav>

        <div className="min-w-0 rounded-2xl border bg-card shadow-[0_1px_2px_0_rgb(16_24_40/0.04)] dark:shadow-none">
          {section === "dashboard" && (
            <Section title="Dashboard" description="Customize your admin dashboard experience.">
              <fieldset>
                <legend className="text-sm font-medium">Dashboard version</legend>
                <div className="mt-3 grid gap-3 sm:grid-cols-2">
                  <VersionCard value="modern" selected={draft.dashboard === "modern"} onSelect={(v) => setDraft({ ...draft, dashboard: v })} title="New dashboard (modern)" body="Modern TradeLoop command center." current={saved.dashboard === "modern"} icon={Sparkles} />
                  <VersionCard value="legacy" selected={draft.dashboard === "legacy"} onSelect={(v) => setDraft({ ...draft, dashboard: v })} title="Old dashboard" body="Previous TradeLoop admin dashboard." current={saved.dashboard === "legacy"} icon={LayoutDashboard} />
                </div>
              </fieldset>
              <div className="mt-5 flex flex-col gap-3 rounded-xl border bg-muted/30 p-4 sm:flex-row sm:items-center sm:justify-between">
                {saved.dashboard === "modern" ? (
                  <>
                    <p className="text-sm text-muted-foreground">Switch back to the previous TradeLoop admin dashboard design.</p>
                    <Button variant="outline" size="lg" className="h-10 shrink-0" onClick={() => setConfirmOld(true)} disabled={switching || saving}>
                      <ArrowLeftRight aria-hidden /> Return to old dashboard
                    </Button>
                  </>
                ) : (
                  <>
                    <p className="text-sm text-muted-foreground">You&apos;re using the old dashboard. The new command center is one click away.</p>
                    <Button
                      size="lg"
                      className="h-10 shrink-0"
                      disabled={switching || saving}
                      onClick={() =>
                        switchTo("modern", () => {
                          setSaved((s) => ({ ...s, dashboard: "modern" }))
                          setDraft((d) => ({ ...d, dashboard: "modern" }))
                        })
                      }
                    >
                      <Sparkles aria-hidden /> Return to new dashboard
                    </Button>
                  </>
                )}
              </div>
            </Section>
          )}

          {section === "appearance" && (
            <Section title="Appearance" description="How the admin area looks for you.">
              <div>
                <p className="text-sm font-medium">Theme</p>
                <p className="mt-0.5 text-xs text-muted-foreground">Changes right away, and is remembered in this browser — like everywhere in TradeLoop.</p>
                <ThemeChoice className="mt-3 max-w-md" />
              </div>
              <fieldset className="mt-7">
                <legend className="text-sm font-medium">Sidebar</legend>
                <p className="mt-0.5 text-xs text-muted-foreground">On a desktop. Tablets always show icons only; phones use the menu.</p>
                <div className="mt-3 grid max-w-md grid-cols-2 gap-3">
                  {(
                    [
                      ["expanded", "Expanded", PanelLeft],
                      ["collapsed", "Collapsed", PanelLeftClose],
                    ] as const
                  ).map(([value, label, Icon]) => (
                    <label key={value} className={cn("flex h-12 cursor-pointer items-center gap-2.5 rounded-xl border px-3 text-sm transition-colors has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-ring/50", draft.sidebar === value ? "border-primary bg-primary/[0.06] font-medium text-foreground dark:bg-primary/10" : "text-muted-foreground hover:bg-muted/50")}>
                      <input type="radio" name="sidebar" value={value} checked={draft.sidebar === value} onChange={() => setDraft({ ...draft, sidebar: value })} className="sr-only" />
                      <Icon className="size-4" aria-hidden /> {label}
                      {draft.sidebar === value && <Check className="ms-auto size-4 text-primary" aria-hidden />}
                    </label>
                  ))}
                </div>
              </fieldset>
            </Section>
          )}

          {section === "notifications" && (
            <Section title="Notifications" description="What the bell in the header shows you. You only ever see alerts for areas your role can open.">
              <ul className="divide-y rounded-xl border">
                {NOTICE_CATEGORIES.map((c) => (
                  <li key={c.key}>
                    <Toggle
                      label={c.label}
                      description={c.description}
                      checked={draft.notify[c.key]}
                      onChange={(on) => setDraft({ ...draft, notify: { ...draft.notify, [c.key as NoticeCategory]: on } })}
                    />
                  </li>
                ))}
              </ul>
            </Section>
          )}

          <div className="sticky bottom-0 flex items-center justify-end gap-3 rounded-b-2xl border-t bg-card/95 px-4 py-3 backdrop-blur max-md:bottom-[calc(4.25rem+env(safe-area-inset-bottom))] sm:px-6">
            {dirty && <span className="me-auto text-xs text-muted-foreground">Unsaved changes</span>}
            <Button size="lg" className="h-10 px-4" onClick={onSave} disabled={!dirty || saving}>
              {saving ? "Saving…" : "Save changes"}
            </Button>
          </div>
        </div>
      </div>

      {/* From Save, the switch is saved with everything else that changed; from the button, it happens at once. */}
      <ReturnToOldDialog
        open={confirmOld}
        onOpenChange={setConfirmOld}
        onConfirm={
          draft.dashboard === "legacy" && saved.dashboard !== "legacy"
            ? () => {
                setConfirmOld(false)
                save()
              }
            : undefined
        }
        onSwitched={() => {
          setSaved((s) => ({ ...s, dashboard: "legacy" }))
          setDraft((d) => ({ ...d, dashboard: "legacy" }))
        }}
      />
    </div>
  )
}

function Section({ title, description, children }: { title: string; description: string; children: React.ReactNode }) {
  return (
    <section className="px-4 py-5 sm:px-6 sm:py-6">
      <h2 className="text-lg font-semibold tracking-tight">{title}</h2>
      <p className="mt-0.5 text-sm text-muted-foreground">{description}</p>
      <div className="mt-5">{children}</div>
    </section>
  )
}

function VersionCard({ value, selected, onSelect, title, body, current, icon: Icon }: { value: DashboardVersion; selected: boolean; onSelect: (v: DashboardVersion) => void; title: string; body: string; current: boolean; icon: React.ElementType }) {
  return (
    <label className={cn("relative flex cursor-pointer gap-3 rounded-xl border p-4 transition-colors has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-ring/50", selected ? "border-primary bg-primary/[0.05] dark:bg-primary/10" : "hover:bg-muted/40")}>
      <input type="radio" name="dashboard" value={value} checked={selected} onChange={() => onSelect(value)} className="sr-only" />
      <span className={cn("mt-0.5 flex size-5 shrink-0 items-center justify-center rounded-full border-2", selected ? "border-primary" : "border-muted-foreground/40")} aria-hidden>
        {selected && <span className="size-2.5 rounded-full bg-primary" />}
      </span>
      <span className="min-w-0">
        <span className="flex flex-wrap items-center gap-2 text-sm font-semibold">
          <Icon className="size-4 text-muted-foreground" aria-hidden /> {title}
          {current && <span className="rounded-full bg-gain/12 px-2 py-0.5 text-[10px] font-semibold text-gain">In use</span>}
        </span>
        <span className="mt-1 block text-xs text-muted-foreground">{body}</span>
      </span>
    </label>
  )
}

function Toggle({ label, description, checked, onChange }: { label: string; description: string; checked: boolean; onChange: (on: boolean) => void }) {
  return (
    <label className="flex min-h-14 cursor-pointer items-center justify-between gap-4 px-4 py-3">
      <span className="min-w-0">
        <span className="block text-sm font-medium">{label}</span>
        <span className="block text-xs text-muted-foreground">{description}</span>
      </span>
      <input type="checkbox" role="switch" checked={checked} onChange={(e) => onChange(e.target.checked)} className="peer sr-only" />
      <span aria-hidden className={cn("relative h-6 w-11 shrink-0 rounded-full transition-colors peer-focus-visible:ring-2 peer-focus-visible:ring-ring/50", checked ? "bg-primary" : "bg-muted-foreground/30")}>
        <span className={cn("absolute top-0.5 size-5 rounded-full bg-white shadow-sm transition-transform", checked ? "translate-x-[22px] rtl:-translate-x-[22px]" : "translate-x-0.5 rtl:-translate-x-0.5")} />
      </span>
    </label>
  )
}

function PageLink({ href, icon: Icon, label }: { href: string; icon: React.ElementType; label: string }) {
  return (
    <Link href={href} className="flex h-10 shrink-0 items-center gap-2.5 rounded-lg px-3 text-sm text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/50 focus-visible:outline-none">
      <Icon className="size-4" aria-hidden /> {label}
      <ArrowUpRight className="ms-auto hidden size-3.5 md:block" aria-hidden />
    </Link>
  )
}
