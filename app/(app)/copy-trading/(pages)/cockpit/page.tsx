import { requireFeature } from "@/lib/features/server"
import { Cockpit } from "@/components/copy/cockpit"

export default async function CopyCockpitPage() {
  await requireFeature("copy_trading")
  return <Cockpit />
}
