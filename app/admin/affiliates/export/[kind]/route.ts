import { NextResponse } from "next/server"
import { getAdmin } from "@/lib/admin/guard"
import { roleCan } from "@/lib/admin/access"
import { logAdminAction } from "@/lib/admin/audit"
import { exportTable, type ExportKind } from "@/lib/affiliates/admin-queries"
import { csvResponse, toCsv } from "@/lib/affiliates/csv"

// Program-wide CSV exports for admins. Each download is in the audit log —
// these files carry affiliate and customer emails.
export const dynamic = "force-dynamic"

const KINDS: ExportKind[] = ["affiliates", "commissions", "payouts", "referrals"]

export async function GET(req: Request, { params }: { params: Promise<{ kind: string }> }) {
  const { kind } = await params
  const admin = await getAdmin()
  // Same answer for "not an admin" and "no such export": the admin area
  // doesn't advertise itself.
  if (!admin || !roleCan(admin.role, { affiliates: ["view"] }) || !KINDS.includes(kind as ExportKind)) return NextResponse.json({ error: "Not found" }, { status: 404 })

  const q = new URL(req.url).searchParams
  const clean = (v: string | null) => (v && /^[a-z_]{1,20}$/.test(v) ? v : undefined)
  const { header, rows } = await exportTable(kind as ExportKind, null, { type: clean(q.get("type")), status: clean(q.get("status")), q: q.get("q")?.slice(0, 80) || undefined })
  await logAdminAction(admin, "affiliate.export", null, { kind, rows: rows.length })
  return csvResponse(`tradeloop-affiliates-${kind}-${new Date().toISOString().slice(0, 10)}.csv`, toCsv(header, rows))
}
