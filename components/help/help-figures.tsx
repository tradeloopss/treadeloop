import { Search, Lock, Check, ArrowRight, ChevronDown, Server, Hash, KeyRound, Building2, UploadCloud, FileSpreadsheet, X } from "lucide-react"
import { cn } from "@/lib/utils"

// Guide "screenshots" for the Help Center, drawn as theme-aware HTML/CSS rather
// than image files. The help subdomain is served through a rewrite layer that
// doesn't expose /public, so a real <img> screenshot would 404 there — these
// mockups need no assets, render on any host, and follow light/dark like the
// rest of the page. They mirror the actual Add-account flow
// (components/accounts/add-account-modal.tsx). Decorative: the caption carries
// the meaning for screen readers.

export type FigureKey = "platform-picker" | "metatrader-form" | "rithmic-form" | "csv-map"

// The dialog chrome the real Add-account window uses: a rounded card with a
// header row and a close control, plus a small "Step n of 3" marker.
function Frame({ step, title, children }: { step: number; title: string; children: React.ReactNode }) {
  return (
    <div aria-hidden className="overflow-hidden rounded-xl border bg-card shadow-sm select-none">
      <div className="flex items-center gap-2 border-b px-3.5 py-2.5">
        <span className="flex size-5 items-center justify-center rounded-md bg-primary/10 text-[10px] font-bold text-primary">TL</span>
        <span className="text-xs font-semibold text-foreground">{title}</span>
        <span className="ms-auto flex items-center gap-2">
          <span className="hidden items-center gap-1 sm:flex">
            {[1, 2, 3].map((n) => (
              <span key={n} className={cn("h-1.5 rounded-full transition-colors", n === step ? "w-5 bg-primary" : "w-2.5 bg-muted-foreground/25")} />
            ))}
          </span>
          <span className="flex size-5 items-center justify-center rounded-md text-muted-foreground/60">
            <X className="size-3.5" />
          </span>
        </span>
      </div>
      <div className="p-4">{children}</div>
    </div>
  )
}

// A form field row: label + a faux "filled" input. `focus` rings it in the
// brand colour to draw the eye; `icon` sits inside like the real inputs.
function Field({ label, value, icon, focus, hint }: { label: string; value: string; icon?: React.ReactNode; focus?: boolean; hint?: string }) {
  return (
    <label className="block">
      <span className="mb-1 flex items-center gap-1.5 text-[11px] font-medium text-muted-foreground">
        {label}
        {hint && <span className="rounded bg-primary/10 px-1.5 py-px text-[10px] font-semibold text-primary">{hint}</span>}
      </span>
      <span className={cn("flex h-9 items-center gap-2 rounded-lg border bg-background px-2.5 text-[13px] text-foreground", focus && "border-primary ring-2 ring-primary/20")}>
        {icon && <span className="text-muted-foreground/70">{icon}</span>}
        <span className="truncate">{value}</span>
      </span>
    </label>
  )
}

function NoteStrip({ children }: { children: React.ReactNode }) {
  return (
    <p className="flex gap-2 rounded-lg border border-primary/25 bg-primary/[0.06] px-2.5 py-2 text-[11px] leading-4 text-muted-foreground">
      <Lock className="mt-px size-3 shrink-0 text-primary" />
      {children}
    </p>
  )
}

function ConnectButton({ label = "Connect" }: { label?: string }) {
  return (
    <span className="mt-1 flex h-9 items-center justify-center gap-1.5 rounded-lg bg-primary text-[13px] font-semibold text-primary-foreground">
      {label} <ArrowRight className="size-3.5" />
    </span>
  )
}

// Step 1 — Choose your platform (the picker grid).
function PlatformPicker() {
  const items = [
    { mono: "R", tint: "bg-sky-500/15 text-sky-500", name: "Rithmic", sub: "Futures prop firms" },
    { mono: "M", tint: "bg-blue-500/15 text-blue-500", name: "MetaTrader 5", sub: "Forex & CFDs", selected: true },
    { mono: "M", tint: "bg-blue-500/15 text-blue-500", name: "MetaTrader 4", sub: "Forex & CFDs" },
    { mono: "T", tint: "bg-indigo-500/15 text-indigo-500", name: "Tradovate", sub: "Futures, via NinjaTrader" },
    { mono: "TV", tint: "bg-teal-500/15 text-teal-500", name: "TradingView", sub: "Paper trading" },
    { mono: "⇪", tint: "bg-primary/10 text-primary", name: "File import", sub: "CSV / broker export" },
  ]
  return (
    <Frame step={1} title="Add account">
      <p className="text-[10px] font-bold tracking-[0.6px] text-primary uppercase">Add account</p>
      <p className="mt-0.5 text-base font-bold text-foreground">Choose your platform</p>
      <span className="mt-3 flex h-8 items-center gap-2 rounded-lg border bg-background px-2.5 text-[12px] text-muted-foreground/70">
        <Search className="size-3.5" /> Search platforms…
      </span>
      <div className="mt-3 grid grid-cols-2 gap-2">
        {items.map((it) => (
          <div key={it.name} className={cn("flex items-center gap-2 rounded-lg border bg-background p-2", it.selected && "border-primary ring-2 ring-primary/20")}>
            <span className={cn("flex size-7 shrink-0 items-center justify-center rounded-md text-xs font-bold", it.tint)}>{it.mono}</span>
            <span className="min-w-0">
              <span className="block truncate text-[12px] font-semibold text-foreground">{it.name}</span>
              <span className="block truncate text-[10px] text-muted-foreground">{it.sub}</span>
            </span>
            {it.selected && <Check className="ms-auto size-3.5 shrink-0 text-primary" strokeWidth={3} />}
          </div>
        ))}
      </div>
      <div className="mt-3">
        <ConnectButton label="Continue" />
      </div>
    </Frame>
  )
}

// Step 2 — MetaTrader credential form.
function MetaTraderForm() {
  return (
    <Frame step={2} title="Connect MetaTrader 5">
      <div className="flex items-center gap-2">
        <span className="flex size-7 items-center justify-center rounded-md bg-blue-500/15 text-xs font-bold text-blue-500">M</span>
        <div>
          <p className="text-[13px] font-semibold text-foreground">Connect your MetaTrader 5 account</p>
          <p className="text-[11px] text-muted-foreground">Use the investor (read-only) password — never your trading password.</p>
        </div>
      </div>
      <div className="mt-4 space-y-3">
        <Field label="Server name" value="Exness-Real6" icon={<Server className="size-3.5" />} />
        <Field label="Account number (login)" value="80412239" icon={<Hash className="size-3.5" />} />
        <Field label="Password" hint="Investor · read-only" value="••••••••••" icon={<KeyRound className="size-3.5" />} focus />
        <NoteStrip>Only the investor password is used — it can view the account but can’t place trades.</NoteStrip>
        <ConnectButton />
      </div>
    </Frame>
  )
}

// Step 2 — Rithmic credential form.
function RithmicForm() {
  return (
    <Frame step={2} title="Connect Rithmic">
      <div className="flex items-center gap-2">
        <span className="flex size-7 items-center justify-center rounded-md bg-sky-500/15 text-xs font-bold text-sky-500">R</span>
        <div>
          <p className="text-[13px] font-semibold text-foreground">Connect your Rithmic account</p>
          <p className="text-[11px] text-muted-foreground">Pick your prop firm, then sign in with your Rithmic login.</p>
        </div>
      </div>
      <div className="mt-4 space-y-3">
        <label className="block">
          <span className="mb-1 block text-[11px] font-medium text-muted-foreground">Prop firm / Rithmic system</span>
          <span className="flex h-9 items-center gap-2 rounded-lg border bg-background px-2.5 text-[13px] text-foreground">
            <Building2 className="size-3.5 text-muted-foreground/70" /> Tradeify
            <ChevronDown className="ms-auto size-3.5 text-muted-foreground/70" />
          </span>
        </label>
        <Field label="Rithmic username" value="tf_04182" icon={<Hash className="size-3.5" />} />
        <Field label="Rithmic password" value="••••••••••" icon={<KeyRound className="size-3.5" />} focus />
        <NoteStrip>Read-only — TradeLoop reads your fills and never places or changes an order.</NoteStrip>
        <ConnectButton />
      </div>
    </Frame>
  )
}

// Step 2 — CSV upload + column mapping.
function CsvMap() {
  const rows = [
    ["Symbol", "Column A"],
    ["Side", "Column C"],
    ["Quantity", "Column D"],
    ["Entry price", "Column E"],
    ["Entry time", "Column B"],
  ]
  return (
    <Frame step={2} title="Import a file">
      <div className="flex flex-col items-center justify-center gap-1.5 rounded-lg border border-dashed bg-background py-4 text-center">
        <UploadCloud className="size-5 text-primary" />
        <p className="text-[12px] font-medium text-foreground">Drop your broker export</p>
        <p className="text-[10px] text-muted-foreground">CSV, or a Tradovate / NinjaTrader / MetaTrader report</p>
      </div>
      <div className="mt-3 flex items-center gap-2 rounded-lg border bg-muted/40 px-2.5 py-1.5">
        <FileSpreadsheet className="size-3.5 text-primary" />
        <span className="text-[11px] font-medium text-foreground">exness-history.csv</span>
        <Check className="ms-auto size-3.5 text-primary" strokeWidth={3} />
      </div>
      <p className="mt-3 mb-1.5 text-[11px] font-semibold text-foreground">Map the columns</p>
      <div className="space-y-1.5">
        {rows.map(([field, col]) => (
          <div key={field} className="flex items-center gap-2 text-[11px]">
            <span className="w-24 shrink-0 text-muted-foreground">{field}</span>
            <ArrowRight className="size-3 shrink-0 text-muted-foreground/50" />
            <span className="flex h-7 flex-1 items-center rounded-md border bg-background px-2 text-foreground">{col}</span>
          </div>
        ))}
      </div>
      <div className="mt-3">
        <ConnectButton label="Import trades" />
      </div>
    </Frame>
  )
}

const FIGURES: Record<FigureKey, () => React.ReactNode> = {
  "platform-picker": PlatformPicker,
  "metatrader-form": MetaTraderForm,
  "rithmic-form": RithmicForm,
  "csv-map": CsvMap,
}

export function HelpFigure({ art, caption }: { art: FigureKey; caption?: string }) {
  const Fig = FIGURES[art]
  if (!Fig) return null
  return (
    <figure className="my-2">
      <div className="mx-auto max-w-sm rounded-2xl border bg-muted/30 p-3 sm:p-4">
        <Fig />
      </div>
      {caption && <figcaption className="mt-2 text-center text-xs text-muted-foreground">{caption}</figcaption>}
    </figure>
  )
}
