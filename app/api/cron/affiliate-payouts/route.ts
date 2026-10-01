import { NextResponse } from "next/server"
import { cronAuthorized } from "@/lib/cron-auth"
import { runPayoutJob } from "@/lib/affiliates/jobs"

// The payout worker by itself: follows up payouts that have a transaction but
// aren't final yet, and creates the automatic payouts that are due. The daily
// affiliate job runs the same steps; this route exists so they can be run more
// often (same Bearer CRON_SECRET as the other cron routes). Safe to call as
// often as you like — a second run in the same period creates nothing.
export const dynamic = "force-dynamic"
export const maxDuration = 60

async function handle(req: Request) {
  if (!cronAuthorized(req)) return NextResponse.json({ error: "unauthorized" }, { status: 401 })
  return NextResponse.json({ ok: true, ...(await runPayoutJob()) })
}

export const GET = handle
export const POST = handle
