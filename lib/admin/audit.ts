import { db } from "@/lib/db"
import { adminAuditLog } from "@/lib/db/schema"
import type { AdminContext } from "@/lib/admin/guard"

// Human-readable names for the audit log page.
export const ACTION_LABELS: Record<string, string> = {
  "user.suspend": "Suspended user",
  "user.unsuspend": "Unsuspended user",
  "user.revoke_sessions": "Signed user out everywhere",
  "user.impersonate": "Logged in as user",
  "user.impersonate_stop": "Stopped logging in as user",
  "user.set_role": "Changed admin role",
  "plan.grant": "Granted plan",
  "plan.revoke_grant": "Revoked granted plan",
  "broker.force_sync": "Forced broker sync",
  "announcement.create": "Created announcement",
  "announcement.update": "Updated announcement",
  "user.reset_2fa": "Reset two-step verification",
  "user.send_password_reset": "Sent password reset email",
  "support.reply": "Replied to support request",
  "support.status": "Changed support request status",
  "import.retry": "Retried failed import",
  "import.dismiss": "Dismissed failed import",
  "import.download": "Downloaded an imported file",
  "broker.mass_sync": "Re-synced all connections",
  "billing.refund": "Refunded a payment",
  "billing.retry_payment": "Retried a failed payment",
  "billing.pause": "Paused billing",
  "billing.resume": "Resumed billing",
  "billing.cancel": "Canceled a subscription",
  "billing.extend": "Extended a subscription",
  "billing.promo_create": "Created promo code",
  "billing.promo_delete": "Deleted promo code",
  "templates.tag_group": "Saved starter tag group",
  "templates.tag_group_delete": "Deleted starter tag group",
  "templates.playbook": "Saved starter playbook",
  "templates.playbook_delete": "Deleted starter playbook",
  "share.disable": "Disabled a public share link",
}

export async function logAdminAction(
  admin: Pick<AdminContext, "id" | "email" | "ip">,
  action: keyof typeof ACTION_LABELS,
  targetUserId: string | null,
  details?: Record<string, unknown>
) {
  await db.insert(adminAuditLog).values({
    actorId: admin.id,
    actorEmail: admin.email,
    action,
    targetUserId,
    details: details ?? null,
    ipAddress: admin.ip,
  })
}
