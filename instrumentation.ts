// Runs once when the Next.js server starts (both `next dev` and `next
// start`) — used here to kick off the Rithmic auto-sync background job,
// since this app has no external cron infrastructure. Node-only: the sync
// logic uses `ws`/DB drivers that don't run on the Edge runtime.
export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    const { startRithmicAutoSync } = await import("@/lib/rithmic-auto-sync")
    startRithmicAutoSync()
  }
}
