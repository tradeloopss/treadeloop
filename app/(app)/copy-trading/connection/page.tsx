import { requireFeature } from "@/lib/features/server"
import { Connection } from "@/components/copy/connection"

export default async function CopyConnectionPage() {
  await requireFeature("copy_trading")
  return <Connection />
}
