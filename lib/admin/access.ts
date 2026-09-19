import { createAccessControl } from "better-auth/plugins/access"
import { defaultStatements } from "better-auth/plugins/admin/access"
import { isAdminRole } from "@/lib/admin/roles"

export { ADMIN_ROLES, ROLE_LABELS, isAdminRole, type AdminRole } from "@/lib/admin/roles"

// Everything an admin role can be allowed to do. `user` and `session` are
// the Better Auth admin plugin's own resources (it enforces them on its
// endpoints); the rest are TradeLoop's, checked by requireAdmin().
export const statement = {
  ...defaultStatements,
  billing: ["view", "manage"],
  brokers: ["view", "sync"],
  analytics: ["view"],
  announcements: ["manage"],
  audit: ["view"],
  team: ["manage"],
  security: ["view", "manage"],
  support: ["view", "reply"],
} as const

export const ac = createAccessControl(statement)

export const roles = {
  user: ac.newRole({ user: [], session: [] }),
  // Everything except impersonating other admins, which no role gets.
  super_admin: ac.newRole({
    user: ["create", "list", "set-role", "ban", "impersonate", "delete", "set-password", "set-email", "get", "update"],
    session: ["list", "revoke", "delete"],
    billing: ["view", "manage"],
    brokers: ["view", "sync"],
    analytics: ["view"],
    announcements: ["manage"],
    audit: ["view"],
    team: ["manage"],
    security: ["view", "manage"],
    support: ["view", "reply"],
  }),
  support: ac.newRole({
    user: ["list", "get", "ban", "impersonate"],
    session: ["list", "revoke"],
    billing: ["view"],
    brokers: ["view", "sync"],
    analytics: ["view"],
    // "manage" = reset a user's 2FA and send password-reset emails.
    security: ["view", "manage"],
    support: ["view", "reply"],
  }),
  billing: ac.newRole({
    user: ["list", "get"],
    billing: ["view", "manage"],
    analytics: ["view"],
  }),
  content: ac.newRole({
    user: ["list"],
    announcements: ["manage"],
  }),
}

export type Permissions = { [K in keyof typeof statement]?: (typeof statement)[K][number][] }

export function roleCan(role: string | null | undefined, permissions: Permissions): boolean {
  if (!isAdminRole(role)) return false
  return roles[role].authorize(permissions as never).success
}
