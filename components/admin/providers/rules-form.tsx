"use client"

import { useState, useTransition } from "react"
import { useRouter } from "next/navigation"
import { toast } from "sonner"
import { publishProviderRules } from "@/app/actions/admin-providers"
import type { ProviderRuleSet, ProviderRules } from "@/lib/compliance/rules"

// A new version of a provider's rules. Every rule is a choice between the
// values the engine knows; the reason and the provider's own page are required.
// A change that allows something the version in force forbids is called out,
// and asks for the provider's approval to be confirmed before it is published.

type Choice<K extends keyof ProviderRules> = { key: K; label: string; hint: string; options: [ProviderRules[K] & string, string][] }
const choice = <K extends keyof ProviderRules>(c: Choice<K>) => c

const RULES = [
  choice({ key: "cloudConnection", label: "Connection from TradeLoop's servers", hint: "Every MetaTrader connection is made from our servers. To a provider that forbids a VPS, that is one.", options: [["approval_required", "Not connected: the provider forbids it"], ["own_risk", "Connected at the trader's own risk: the provider forbids it"], ["allowed", "Permitted by the provider"]] }),
  choice({ key: "masterCredential", label: "Master credential", hint: "What a Master connection may log in with.", options: [["investor_only", "Investor / read-only password only"], ["any", "Investor or trading password"]] }),
  choice({ key: "execution", label: "Orders placed by TradeLoop", hint: "Whether TradeLoop may place orders on the provider's accounts.", options: [["blocked", "Blocked"], ["allowed", "Allowed"]] }),
  choice({ key: "toExternal", label: "Provider → external account", hint: "The provider's account is the Master.", options: [["allowed", "Allowed"], ["blocked", "Blocked"]] }),
  choice({ key: "fromExternal", label: "External account → provider", hint: "The provider's account is the Follower.", options: [["blocked", "Blocked"], ["allowed", "Allowed"]] }),
  choice({ key: "ownToOwn", label: "Own account → own account", hint: "Both at the provider, the same person's.", options: [["allowed", "Allowed"], ["blocked", "Blocked"]] }),
  choice({ key: "ownershipProof", label: "Proof of ownership for own → own", hint: "TradeLoop has no way to prove two accounts are one person's: while required, own → own stays off.", options: [["required", "Required"], ["not_required", "Not required"]] }),
  choice({ key: "crossUser", label: "Another person's account → the trader's", hint: "Both at the provider, different people's.", options: [["blocked", "Blocked"], ["allowed", "Allowed"]] }),
  choice({ key: "thirdPartyEa", label: "Third-party EAs", hint: "Shown to the trader; not enforced by TradeLoop.", options: [["restricted", "Restricted"], ["allowed", "Allowed"], ["blocked", "Blocked"]] }),
]

// what each rule's most cautious value is: moving away from it allows more
const STRICT: Partial<Record<keyof ProviderRules, string>> = { cloudConnection: "approval_required", masterCredential: "investor_only", execution: "blocked", toExternal: "blocked", fromExternal: "blocked", ownToOwn: "blocked", ownershipProof: "required", crossUser: "blocked" }

const field = "h-9 w-full min-w-0 rounded-md border bg-background px-2.5 text-sm focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"

export function RulesForm({ set }: { set: ProviderRuleSet }) {
  const router = useRouter()
  const [pending, startTransition] = useTransition()
  const [rules, setRules] = useState<ProviderRules>(set.rules)
  const [status, setStatus] = useState(set.status)
  const [effectiveDate, setEffectiveDate] = useState(new Date().toISOString().slice(0, 10))
  const [sources, setSources] = useState(set.sources.map((s) => `${s.label} | ${s.url}`).join("\n"))
  const [notes, setNotes] = useState(set.rules.notes.join("\n"))
  const [maxAllocation, setMaxAllocation] = useState(set.rules.maxAllocation == null ? "" : String(set.rules.maxAllocation))
  const [note, setNote] = useState("")
  const [approved, setApproved] = useState(false)

  // rules this version would relax, compared with the one in force
  const CLOUD = { approval_required: 0, own_risk: 1, allowed: 2 }
  const loosened = RULES.filter((r) => (r.key === "cloudConnection" ? CLOUD[rules.cloudConnection] > CLOUD[set.rules.cloudConnection] : set.rules[r.key] === STRICT[r.key] && rules[r.key] !== set.rules[r.key])).map((r) => r.label)
  // connecting against the provider's rule is TradeLoop's own decision, not something the provider approved
  const ownRisk = rules.cloudConnection === "own_risk" && set.rules.cloudConnection === "approval_required"
  if (set.status === "disabled" && status === "active") loosened.push("Integration switched back on")

  const publish = () => {
    if (loosened.length && !approved) return
    if (loosened.length && !window.confirm(`Publish ${set.name} rules v${set.version + 1}? It allows what v${set.version} does not:\n\n• ${loosened.join("\n• ")}\n\nTraders' accounts are what is at stake if the provider has not approved this.`)) return
    const raw = {
      status,
      effectiveDate,
      note,
      sources: sources
        .split("\n")
        .map((line) => line.trim())
        .filter(Boolean)
        .map((line) => {
          const at = line.lastIndexOf("|")
          return at < 0 ? { label: "", url: line } : { label: line.slice(0, at).trim(), url: line.slice(at + 1).trim() }
        }),
      rules: { ...rules, maxAllocation: maxAllocation.trim() === "" ? null : Number(maxAllocation), notes: notes.split("\n").map((n) => n.trim()).filter(Boolean) },
    }
    startTransition(async () => {
      const result = await publishProviderRules(set.provider, raw)
      if (!result.ok) {
        toast.error(result.error)
        return
      }
      toast.success(result.message)
      setNote("")
      setApproved(false)
      router.refresh()
    })
  }

  return (
    <fieldset disabled={pending} className="space-y-4">
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="block text-sm">
          <span className="font-medium">Integration</span>
          <select className={`${field} mt-1`} value={status} onChange={(e) => setStatus(e.target.value as ProviderRuleSet["status"])}>
            <option value="active">Enabled</option>
            <option value="disabled">Disabled for everyone</option>
          </select>
          <span className="mt-1 block text-xs text-muted-foreground">Disabled: no account of this provider is connected, and no Copy Group may contain one.</span>
        </label>
        {RULES.map((r) => (
          <label key={r.key} className="block text-sm">
            <span className="font-medium">{r.label}</span>
            <select className={`${field} mt-1`} value={String(rules[r.key])} onChange={(e) => setRules({ ...rules, [r.key]: e.target.value })}>
              {r.options.map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </select>
            <span className="mt-1 block text-xs text-muted-foreground">{r.hint}</span>
          </label>
        ))}
        <label className="block text-sm">
          <span className="font-medium">Maximum allocation</span>
          <input className={`${field} mt-1`} inputMode="decimal" value={maxAllocation} onChange={(e) => setMaxAllocation(e.target.value)} placeholder="None" />
          <span className="mt-1 block text-xs text-muted-foreground">Across the trader&apos;s accounts at the provider. Shown to the trader; empty for none.</span>
        </label>
        <label className="block text-sm">
          <span className="font-medium">Effective date</span>
          <input type="date" className={`${field} mt-1`} value={effectiveDate} onChange={(e) => setEffectiveDate(e.target.value)} />
        </label>
      </div>
      <label className="block text-sm">
        <span className="font-medium">Sources</span>
        <textarea className={`${field} mt-1 h-20 py-2 font-mono text-xs`} value={sources} onChange={(e) => setSources(e.target.value)} />
        <span className="mt-1 block text-xs text-muted-foreground">One per line: name | https://… The provider&apos;s own pages only.</span>
      </label>
      <label className="block text-sm">
        <span className="font-medium">Notes for the trader</span>
        <textarea className={`${field} mt-1 h-24 py-2 text-xs`} value={notes} onChange={(e) => setNotes(e.target.value)} />
        <span className="mt-1 block text-xs text-muted-foreground">One per line: account-type restrictions and the like.</span>
      </label>
      <label className="block text-sm">
        <span className="font-medium">Why this version</span>
        <textarea className={`${field} mt-1 h-16 py-2`} value={note} onChange={(e) => setNote(e.target.value)} placeholder="What changed at the provider, and where it says so." />
        <span className="mt-1 block text-xs text-muted-foreground">Kept with the version and in the audit log.</span>
      </label>
      {loosened.length > 0 && (
        <div role="alert" className="rounded-lg border border-amber-500/40 bg-amber-500/10 p-3 text-sm">
          <p className="font-semibold">This version allows what the one in force does not</p>
          <ul className="mt-1 list-disc ps-5 text-xs">
            {loosened.map((l) => (
              <li key={l}>{l}</li>
            ))}
          </ul>
          <p className="mt-2 text-xs">
            A trader&apos;s account at {set.name} is what is lost if {set.name} has not agreed to this.{" "}
            {ownRisk
              ? `Connecting at the trader's own risk means ${set.name} has not agreed: each trader is told so and must accept the risk before connecting.`
              : `Publish it only with ${set.name}'s approval in writing, and say where it is in the reason above.`}
          </p>
          <label className="mt-2 flex items-start gap-2 text-xs font-medium">
            <input type="checkbox" className="mt-0.5 size-4 accent-[var(--primary)]" checked={approved} onChange={(e) => setApproved(e.target.checked)} />
            {ownRisk && loosened.length === 1 ? `I am allowing this knowing ${set.name} does not permit it.` : `I have ${set.name}'s written approval for every change listed${ownRisk ? " except the connection, which it does not permit" : ""}, and the reason says where it is.`}
          </label>
        </div>
      )}
      <button type="button" onClick={publish} disabled={pending || note.trim().length < 10 || (loosened.length > 0 && !approved)} className="inline-flex h-9 items-center justify-center rounded-md bg-primary px-4 text-sm font-medium text-primary-foreground transition-opacity hover:opacity-90 disabled:opacity-50">
        {pending ? "Publishing…" : `Publish v${set.version + 1}`}
      </button>
    </fieldset>
  )
}
