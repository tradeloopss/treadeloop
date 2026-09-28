import { Rocket, Plug, NotebookPen, Activity, ShieldCheck, CreditCard, HelpCircle, Info, TriangleAlert, type LucideIcon } from "lucide-react"
import { cn } from "@/lib/utils"
import type { Block } from "@/lib/help/content"

const ICONS: Record<string, LucideIcon> = {
  rocket: Rocket,
  plug: Plug,
  notebook: NotebookPen,
  activity: Activity,
  shield: ShieldCheck,
  card: CreditCard,
  help: HelpCircle,
}

export function HelpIcon({ name, className }: { name: string; className?: string }) {
  const Icon = ICONS[name] ?? HelpCircle
  return <Icon className={className} />
}

// Renders a guide's structured body into clean, styled elements.
export function ArticleBody({ blocks }: { blocks: Block[] }) {
  return (
    <div className="space-y-5">
      {blocks.map((b, i) => {
        switch (b.t) {
          case "h":
            return (
              <h2 key={i} className="pt-2 text-lg font-semibold tracking-tight">
                {b.text}
              </h2>
            )
          case "p":
            return (
              <p key={i} className="leading-relaxed text-muted-foreground">
                {b.text}
              </p>
            )
          case "list":
            return (
              <ul key={i} className="space-y-2">
                {b.items.map((it, j) => (
                  <li key={j} className="flex gap-2.5 leading-relaxed text-muted-foreground">
                    <span className="mt-2 size-1.5 shrink-0 rounded-full bg-primary" />
                    {it}
                  </li>
                ))}
              </ul>
            )
          case "steps":
            return (
              <ol key={i} className="space-y-3">
                {b.items.map((it, j) => (
                  <li key={j} className="flex gap-3 leading-relaxed">
                    <span className="flex size-6 shrink-0 items-center justify-center rounded-full bg-primary/10 text-xs font-semibold text-primary">{j + 1}</span>
                    <span className="pt-0.5 text-muted-foreground">{it}</span>
                  </li>
                ))}
              </ol>
            )
          case "note":
          case "warn": {
            const warn = b.t === "warn"
            return (
              <div key={i} className={cn("flex gap-3 rounded-xl border p-4 text-sm", warn ? "border-amber-500/40 bg-amber-500/10 text-amber-700 dark:text-amber-300" : "border-primary/30 bg-primary/5")}>
                {warn ? <TriangleAlert className="mt-0.5 size-4 shrink-0" /> : <Info className="mt-0.5 size-4 shrink-0 text-primary" />}
                <p className="leading-relaxed">{b.text}</p>
              </div>
            )
          }
        }
      })}
    </div>
  )
}
