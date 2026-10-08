import { requireFeature } from "@/lib/features/server"
import { CopyDashboard } from "@/components/copy/dashboard"

export default async function CopyDashboardPage() {
  await requireFeature("copy_trading")
  return <CopyDashboard />
}
