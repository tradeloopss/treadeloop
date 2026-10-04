"use client"

import { useState } from "react"
import { useRouter } from "next/navigation"
import { Trash2 } from "lucide-react"
import { cn } from "@/lib/utils"
import { addRule, removeRule, toggleRule } from "@/app/actions/edge-lab"
import { fmtMoney } from "@/lib/edge/core"
import { useAction } from "./client"
import { Section, fieldClass, linkBtnPrimary, toneClass } from "./ui"

export type RuleView = { id: number; text: string; source: string; active: boolean; createdAt: string; breaks: { n: number; net: number } | null }
const SOURCES: Record<string, string> = { manual: "Written by you", edge_leak: "From a leak", psych_pattern: "From a pattern", coach: "From the coach" }

// The trader's own rules — the ones made from a leak or a pattern, and the
// ones they wrote. A rule tied to conditions counts the trades that broke it.
export function RulesList({ rules }: { rules: RuleView[] }) {
  const router = useRouter()
  const { pending, run } = useAction()
  const [text, setText] = useState("")
  return (
    <Section id="rules" title="Your rules" description="Rules made from a leak or a pattern are checked against your new trades. Nothing is blocked — they are yours to keep.">
      {rules.length === 0 ? (
        <p className="text-sm text-muted-foreground">No rules yet. Create one from a leak or a pattern, or write your own below.</p>
      ) : (
        <ul className="divide-y">
          {rules.map((r) => (
            <li key={r.id} className="flex items-center gap-3 py-2.5">
              <label className="flex min-w-0 flex-1 items-start gap-2.5">
                <input type="checkbox" className="mt-0.5 size-4 shrink-0 accent-[var(--primary)]" checked={r.active} disabled={pending} onChange={(e) => run(() => toggleRule(r.id, e.target.checked), () => router.refresh())} aria-label={`${r.active ? "Pause" : "Resume"} rule: ${r.text}`} />
                <span className="min-w-0">
                  <span className={cn("block text-sm font-medium", !r.active && "text-muted-foreground line-through")}>{r.text}</span>
                  <span className="mt-0.5 block text-xs text-muted-foreground">
                    {SOURCES[r.source] ?? "Rule"}
                    {r.breaks &&
                      (r.breaks.n === 0 ? (
                        " · kept since you made it"
                      ) : (
                        <>
                          {" · broken "}
                          {r.breaks.n} {r.breaks.n === 1 ? "time" : "times"} since, <span className={toneClass(r.breaks.net)}>{fmtMoney(r.breaks.net)}</span>
                        </>
                      ))}
                  </span>
                </span>
              </label>
              <button type="button" disabled={pending} aria-label={`Delete rule: ${r.text}`} onClick={() => window.confirm("Delete this rule?") && run(() => removeRule(r.id), () => router.refresh())} className="flex size-8 shrink-0 items-center justify-center rounded-md text-muted-foreground hover:bg-muted hover:text-[var(--loss)]">
                <Trash2 className="size-4" />
              </button>
            </li>
          ))}
        </ul>
      )}
      <form
        className="flex gap-2"
        onSubmit={(e) => {
          e.preventDefault()
          run(
            () => addRule({ text, source: "manual" }),
            () => {
              setText("")
              router.refresh()
            },
          )
        }}
      >
        <label className="flex-1">
          <span className="sr-only">New rule</span>
          <input className={fieldClass} maxLength={240} placeholder="Write a rule, e.g. “No trades after two losses in a day”" value={text} onChange={(e) => setText(e.target.value)} />
        </label>
        <button type="submit" disabled={pending || text.trim().length < 4} className={cn(linkBtnPrimary, "h-9")}>
          Add rule
        </button>
      </form>
    </Section>
  )
}
