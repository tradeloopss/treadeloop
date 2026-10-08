import { headers } from "next/headers"
import { requireFeature } from "@/lib/features/server"
import { friendsOverview } from "@/lib/copy/friends-server"
import { resolveTimeZone } from "@/lib/timezone"
import { Friends } from "@/components/copy/friends"

// Friends: who copies the strategies this trader shares, and the strategies
// they copy (lib/copy/friends.ts). Read for the trader the session resolved.
export default async function CopyFriendsPage() {
  const { userId } = await requireFeature("copy_trading")
  return <Friends initial={await friendsOverview(userId, resolveTimeZone(await headers()))} />
}
