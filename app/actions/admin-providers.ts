"use server"

import { revalidatePath } from "next/cache"
import { assertAdmin } from "@/lib/admin/guard"
import { logAdminAction } from "@/lib/admin/audit"
import { publishRuleSet, ruleChanges } from "@/lib/compliance/server"
import { revalidateGroups } from "@/lib/copy/server"

type Result = { ok: true; message: string } | { ok: false; error: string }

// Admin: a new version of a provider's rules (lib/compliance). The version is
// checked as typed, stored beside the earlier ones, and recorded in the audit
// log with what changed and why. Every active Copy Group with one of the
// provider's accounts is then asked again, and one the new rules object to
// stops copying.
export async function publishProviderRules(provider: string, raw: unknown): Promise<Result> {
  try {
    const admin = await assertAdmin({ team: ["manage"] })
    const { before, after } = await publishRuleSet(admin, String(provider), raw)
    const changes = ruleChanges(before, after)
    await logAdminAction(admin, "provider.rules_publish", null, { provider: after.provider, from: before.version, to: after.version, changes, note: after.note })
    const paused = await revalidateGroups(after.provider)
    revalidatePath("/", "layout")
    const changed = Object.keys(changes).length
    return { ok: true, message: `${after.name} rules v${after.version} are in force${changed ? ` (${changed} ${changed === 1 ? "rule" : "rules"} changed)` : ""}.${paused ? ` ${paused} Copy ${paused === 1 ? "Group was" : "Groups were"} paused: the new rules don't allow ${paused === 1 ? "it" : "them"}.` : ""}` }
  } catch (err) {
    const message = err instanceof Error ? err.message : ""
    return { ok: false, error: !message || message.startsWith("Failed query") ? "Something went wrong. Try again." : message }
  }
}
