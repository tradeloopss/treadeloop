import { requireFeature } from "@/lib/features/server"
import { readInvite } from "@/lib/copy/shares"
import { JoinInvite } from "@/components/copy/sharing"

// An invitation to follow a friend's strategy (lib/copy/shares.ts): what is
// offered and on what terms, before anything is accepted. Only for a trader
// who may use Copy Trading; the link gives nobody anything by itself.
export default async function CopyJoinPage({ params }: { params: Promise<{ token: string }> }) {
  const { userId } = await requireFeature("copy_trading")
  const { token } = await params
  return <JoinInvite token={token} invite={await readInvite(userId, token)} />
}
