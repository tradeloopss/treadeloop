import { timingSafeEqual } from "node:crypto"

// The sync VPS calls the /api/cron/* routes with `Authorization: Bearer
// $CRON_SECRET`. Constant-time compare; a missing secret refuses everything.
export function cronAuthorized(req: Request): boolean {
  const secret = process.env.CRON_SECRET
  if (!secret) return false
  const got = Buffer.from(req.headers.get("authorization") ?? "")
  const want = Buffer.from(`Bearer ${secret}`)
  return got.length === want.length && timingSafeEqual(got, want)
}
