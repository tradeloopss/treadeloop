import { headers } from "next/headers"
import { redirect } from "next/navigation"
import { auth } from "@/lib/auth"
import { readInvite } from "@/lib/copy/shares"
import { JoinInvite } from "@/components/copy/sharing"

// An invitation to follow a friend's strategy (lib/copy/shares.ts): what is
// offered and on what terms, before anything is accepted. For anyone signed
// in: it sits beside Copy Trading's own pages, not under their gate, because
// accepting it is what opens Copy Trading to the friend. The link gives nobody
// anything by itself.
export default async function CopyJoinPage({ params }: { params: Promise<{ token: string }> }) {
  const session = await auth.api.getSession({ headers: await headers() })
  if (!session?.user) redirect("/sign-in")
  const { token } = await params
  return (
    <div className="p-4 sm:p-6">
      <JoinInvite token={token} invite={await readInvite(session.user.id, token)} />
    </div>
  )
}
