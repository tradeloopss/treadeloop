// Admin role names and labels, safe to import from client components
// (the permission rules themselves live in lib/admin/access.ts).
export const ADMIN_ROLES = ["super_admin", "support", "billing", "content"] as const
export type AdminRole = (typeof ADMIN_ROLES)[number]

export const ROLE_LABELS: Record<AdminRole, string> = {
  super_admin: "Super Admin",
  support: "Support",
  billing: "Billing Manager",
  content: "Content",
}

export function isAdminRole(role: string | null | undefined): role is AdminRole {
  return !!role && (ADMIN_ROLES as readonly string[]).includes(role)
}
