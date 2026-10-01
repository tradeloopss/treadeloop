import { NextResponse } from "next/server"
import { cronAuthorized } from "@/lib/cron-auth"
import { runDailyJob } from "@/lib/affiliates/jobs"

// The daily affiliate job: clears commissions whose hold has passed, picks up
// refunds from Whop, re-scores risk and sends the monthly report. Called by
// Vercel Cron (vercel.json — a GET carrying `Authorization: Bearer
// $CRON_SECRET`) and callable the same way by the sync VPS as a POST.
export const dynamic = "force-dynamic"
export const maxDuration = 60

async function handle(req: Request) {
  if (!cronAuthorized(req)) return NextResponse.json({ error: "unauthorized" }, { status: 401 })
  return NextResponse.json({ ok: true, ...(await runDailyJob()) })
}

export const GET = handle
export const POST = handle
