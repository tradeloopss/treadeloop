import { requireFeature } from "@/lib/features/server"
import { RiskManagement } from "@/components/copy/risk"

export default async function CopyRiskPage() {
  await requireFeature("copy_trading")
  return <RiskManagement />
}
