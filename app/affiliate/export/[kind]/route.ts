import { NextResponse } from "next/server"
import { getSessionUser } from "@/lib/affiliates/guard"
import { exportTable, type ExportKind } from "@/lib/affiliates/admin-queries"
import { csvResponse, toCsv } from "@/lib/affiliates/csv"
import { getAffiliateByUser } from "@/lib/affiliates/queries"

// An affiliate's own data as CSV: commissions, payouts or referrals. Scoped to
// the affiliate of the signed-in session — there is no id in the URL to tamper
// with — and never includes a referred customer's identity.
export const dynamic = "force-dynamic"

const KINDS: ExportKind[] = ["commissions", "payouts", "referrals"]

export async function GET(req: Request, { params }: { params: Promise<{ kind: string }> }) {
  const { kind } = await params
  if (!KINDS.includes(kind as ExportKind)) return NextResponse.json({ error: "Not found" }, { status: 404 })
  const user = await getSessionUser()
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  const affiliate = await getAffiliateByUser(user.id)
  if (!affiliate || affiliate.status !== "approved") return NextResponse.json({ error: "Forbidden" }, { status: 403 })

  const q = new URL(req.url).searchParams
  const clean = (v: string | null) => (v && /^[a-z_]{1,20}$/.test(v) ? v : undefined)
  const { header, rows } = await exportTable(kind as ExportKind, affiliate.id, { type: clean(q.get("type")), status: clean(q.get("status")) })
  return csvResponse(`tradeloop-affiliate-${kind}-${new Date().toISOString().slice(0, 10)}.csv`, toCsv(header, rows))
}
