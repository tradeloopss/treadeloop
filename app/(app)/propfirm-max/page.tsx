import { getPropMaxData, getPropMaxAlerts } from "@/app/actions/propmax"
import { PropMaxWorkspace } from "@/components/propmax/propmax-workspace"

export const metadata = { title: "PropFirm Max" }

export default async function PropFirmMaxPage() {
  const [{ accounts, catalog }, alerts] = await Promise.all([getPropMaxData(), getPropMaxAlerts()])
  return <PropMaxWorkspace accounts={accounts} catalog={catalog} alerts={alerts} />
}
