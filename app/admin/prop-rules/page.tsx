import { isNull } from "drizzle-orm"
import { requireAdmin } from "@/lib/admin/guard"
import { db } from "@/lib/db"
import { propFirm, propProgram, propRuleVersion } from "@/lib/db/schema"
import { AdminPageHeader, Panel, EmptyRow } from "@/components/admin/ui"
import { PropRulesActions } from "@/components/admin/prop-rules-panel"
import { ruleLabel, formatValue } from "@/components/propmax/display"
import type { RuleConfig } from "@/lib/propmax/types"

function summarize(rules: RuleConfig[]): string {
  return rules
    .filter((r) => r.enabled !== false && r.value != null)
    .map((r) => `${ruleLabel(r.type)} ${formatValue(r.value ?? null, r.unit ?? "count")}`)
    .join(" · ")
}

function size(v: number | null): string {
  if (v == null) return "any size"
  return v % 1000 === 0 ? `$${v / 1000}K` : `$${v.toLocaleString()}`
}

export default async function AdminPropRulesPage() {
  await requireAdmin({ brokers: ["view"] })

  const [firms, programs, versions] = await Promise.all([
    db.select().from(propFirm),
    db.select().from(propProgram),
    db.select().from(propRuleVersion).where(isNull(propRuleVersion.effectiveTo)),
  ])
  firms.sort((a, b) => a.name.localeCompare(b.name))

  const programsByFirm = new Map<number, typeof programs>()
  for (const p of programs) {
    const list = programsByFirm.get(p.firmId) ?? []
    list.push(p)
    programsByFirm.set(p.firmId, list)
  }
  const versionsByProgram = new Map<number, typeof versions>()
  for (const v of versions) {
    const list = versionsByProgram.get(v.programId) ?? []
    list.push(v)
    versionsByProgram.set(v.programId, list)
  }

  // For the "new version" picker.
  const programOptions = programs
    .map((p) => ({ id: p.id, label: `${firms.find((f) => f.id === p.firmId)?.name ?? "?"} — ${p.name}` }))
    .sort((a, b) => a.label.localeCompare(b.label))

  return (
    <div>
      <AdminPageHeader
        title="Prop firm rules"
        description="The sourced, versioned rule catalog Propfirm Tracker evaluates against. Seed it from the researched presets, then publish new versions as firms change their rules — each version keeps its source and history."
        action={<PropRulesActions programs={programOptions} seedOnly />}
      />
      <div className="space-y-6 p-4 sm:p-6">
        {firms.length === 0 ? (
          <Panel title="Catalog is empty">
            <p className="p-4 text-sm text-muted-foreground">
              No firms yet. Seed the catalog from the researched presets to get started.
            </p>
          </Panel>
        ) : (
          firms.map((firm) => {
            const firmPrograms = programsByFirm.get(firm.id) ?? []
            return (
              <Panel key={firm.id} title={firm.name} description={firm.website ?? undefined}>
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b text-left text-xs text-muted-foreground">
                        <th className="px-4 py-2 font-medium">Program</th>
                        <th className="px-4 py-2 font-medium">Size</th>
                        <th className="px-4 py-2 font-medium">Phase</th>
                        <th className="px-4 py-2 font-medium">v</th>
                        <th className="px-4 py-2 font-medium">Rules (in force)</th>
                        <th className="px-4 py-2 font-medium">Source</th>
                      </tr>
                    </thead>
                    <tbody>
                      {firmPrograms.flatMap((program) => {
                        const pv = (versionsByProgram.get(program.id) ?? []).sort(
                          (a, b) => (a.accountSize ?? 0) - (b.accountSize ?? 0) || a.phase.localeCompare(b.phase),
                        )
                        if (pv.length === 0) {
                          return [
                            <tr key={`p-${program.id}`} className="border-b">
                              <td className="px-4 py-2">{program.name}</td>
                              <td className="px-4 py-2 text-muted-foreground" colSpan={5}>
                                no versions yet
                              </td>
                            </tr>,
                          ]
                        }
                        return pv.map((v) => (
                          <tr key={v.id} className="border-b align-top">
                            <td className="px-4 py-2">{program.name}</td>
                            <td className="px-4 py-2 whitespace-nowrap">{size(v.accountSize)}</td>
                            <td className="px-4 py-2 capitalize">{v.phase}</td>
                            <td className="px-4 py-2 tabular-nums">{v.version}</td>
                            <td className="px-4 py-2 text-xs text-muted-foreground">{summarize(v.rules as RuleConfig[])}</td>
                            <td className="px-4 py-2 text-xs">
                              <div>{v.sourceName}</div>
                              <div className="text-muted-foreground">{v.confidence} confidence</div>
                            </td>
                          </tr>
                        ))
                      })}
                      {firmPrograms.length === 0 && <EmptyRow colSpan={6}>No programs.</EmptyRow>}
                    </tbody>
                  </table>
                </div>
              </Panel>
            )
          })
        )}

        <Panel title="Publish a new rule version" description="Retires the current in-force version for a program/size/phase and records the new one with its source and a change reason.">
          <div className="p-4">
            <PropRulesActions programs={programOptions} />
          </div>
        </Panel>
      </div>
    </div>
  )
}
