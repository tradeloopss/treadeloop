import Link from "next/link"
import { RECENT_WINDOW } from "@/lib/edge/monitor"
import { insightPage, type SearchParams } from "@/lib/edge/page"
import { alerts, listRules, monitors, ruleBreaks } from "@/lib/edge/server"
import { cleanConditions } from "@/lib/edge/core"
import { NotEnough, Section, linkBtn } from "@/components/insights/ui"
import { RulesList } from "@/components/insights/rules"
import { EdgeSheetProvider } from "@/components/edge-lab/edge-sheet"
import { AlertList, MonitorCard } from "@/components/edge-lab/monitor"

// The edges being watched, always judged on the whole history: the latest
// trades against everything before them.
export default async function MonitorPage({ searchParams }: { searchParams: SearchParams }) {
  const { userId, loaded } = await insightPage("edge_lab", searchParams)
  // checking the monitors is also what raises an alert when one has changed state
  const rows = await monitors(userId, loaded.all)
  const [alertRows, rules] = await Promise.all([alerts(userId), listRules(userId)])

  return (
    <EdgeSheetProvider>
      <Section title="Watched edges" description={`Each compares its latest ${RECENT_WINDOW} matching trades with the ones before. Date filters don't apply here.`} action={<Link href="/edge-lab/discover" className={linkBtn}>Find an edge to watch</Link>}>
        {rows.length === 0 ? (
          <NotEnough title="Nothing is being watched">Open an edge anywhere in Edge Lab and press “Watch”, or add one to a playbook. It then appears here with its health.</NotEnough>
        ) : (
          <ul className="grid gap-3 lg:grid-cols-2">
            {rows.map((m) => (
              <MonitorCard key={m.id} row={{ id: m.id, name: m.name, conditions: m.conditions, playbookId: m.playbookId, notifyInApp: m.notifyInApp, notifyEmail: m.notifyEmail, since: m.createdAt.toISOString(), view: m.view }} />
            ))}
          </ul>
        )}
      </Section>

      <Section title="Alerts" description="Raised when a watched edge changes state. Checked whenever you open Edge Lab.">
        <AlertList alerts={alertRows.map((a) => ({ id: a.id, title: a.title, body: a.body ?? "", kind: a.kind, at: a.createdAt.toISOString(), unread: !a.readAt }))} />
      </Section>

      <RulesList rules={rules.map((r) => ({ id: r.id, text: r.text, source: r.source, active: r.active, createdAt: r.createdAt.toISOString(), breaks: r.active ? ruleBreaks(loaded.all, r.conditions ? cleanConditions(r.conditions) : null, r.createdAt.getTime()) : null }))} />
    </EdgeSheetProvider>
  )
}
