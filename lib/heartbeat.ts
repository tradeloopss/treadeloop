import { getAppSetting, setAppSetting } from "@/lib/app-settings"

// A background job's last pass, so the admin System Health panel can tell "it
// ran a minute ago and finished cleanly" from "it hasn't run for an hour" —
// from the job's own record, not a guess. One app_settings row per job,
// overwritten on every pass. Only step names are kept, never error text.

export type HeartbeatJob = "rithmic_sync" | "affiliate_payouts"
export type Heartbeat = { at: Date; ok: boolean; failed: string | null }

const key = (job: HeartbeatJob) => `heartbeat:${job}`

export async function recordHeartbeat(job: HeartbeatJob, failedSteps: string[] = []): Promise<void> {
  try {
    await setAppSetting(key(job), { at: new Date().toISOString(), ok: failedSteps.length === 0, failed: failedSteps.join(", ").slice(0, 120) || null })
  } catch (e) {
    // Never let the record of a pass break the pass.
    console.error(`[heartbeat] ${job}:`, e instanceof Error ? e.message : e)
  }
}

export async function readHeartbeat(job: HeartbeatJob): Promise<Heartbeat | null> {
  const v = await getAppSetting<{ at?: unknown; ok?: unknown; failed?: unknown }>(key(job))
  if (!v || typeof v.at !== "string" || Number.isNaN(Date.parse(v.at))) return null
  return { at: new Date(v.at), ok: v.ok !== false, failed: typeof v.failed === "string" ? v.failed : null }
}
