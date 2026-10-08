"use server"

import { headers } from "next/headers"
import { revalidatePath } from "next/cache"
import { auth } from "@/lib/auth"
import { joinShare } from "@/lib/copy/shares"

// Accepting an invitation to follow a friend's strategy (lib/copy/shares.ts).
// It asks for a signed-in trader and nothing more: the invitation is itself
// what opens Copy Trading to them (lib/features/server.ts), so this can't sit
// behind the feature as the other Copy Trading actions do.
export async function acceptCopyInvite(token: string, attested: boolean): Promise<{ ok: true; name: string } | { ok: false; error: string }> {
  try {
    const session = await auth.api.getSession({ headers: await headers() })
    if (!session?.user) throw new Error("Sign in to continue.")
    const joined = await joinShare(session.user.id, String(token ?? ""), attested === true)
    // the menu now has Copy Trading in it
    revalidatePath("/", "layout")
    return { ok: true, name: joined.name }
  } catch (err) {
    const message = err instanceof Error ? err.message : ""
    return { ok: false, error: !message || message.startsWith("Failed query") ? "Something went wrong. Try again." : message }
  }
}
