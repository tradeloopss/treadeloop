import { getPropMaxData } from "@/app/actions/propmax"
import { PropMaxWorkspace } from "@/components/propmax/propmax-workspace"

export const metadata = { title: "PropFirm Max" }

export default async function PropFirmMaxPage() {
  const { accounts, catalog } = await getPropMaxData()
  return <PropMaxWorkspace accounts={accounts} catalog={catalog} />
}
