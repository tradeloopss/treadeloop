// Runs once when the Next.js server starts (both `next dev` and `next
// start`) — used here to kick off the Rithmic auto-sync background job,
// since this app has no external cron infrastructure. Node-only: the sync
// logic uses `ws`/DB drivers that don't run on the Edge runtime.
//
// RITHMIC_AUTOSYNC=off disables the loop on a given deployment. Exactly one
// deployment should run it — two loops syncing the same logins collide on
// Rithmic's one-session-per-login rule — so when the persistent sync worker
// on the VPS takes it over, Vercel gets RITHMIC_AUTOSYNC=off.
export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs" && process.env.RITHMIC_AUTOSYNC !== "off") {
    const { startRithmicAutoSync } = await import("@/lib/rithmic-auto-sync")
    startRithmicAutoSync()
  }
}
