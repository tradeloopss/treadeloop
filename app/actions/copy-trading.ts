"use server"

import { headers } from "next/headers"
import { revalidatePath } from "next/cache"
import { assertAdmin } from "@/lib/admin/guard"
import { logAdminAction } from "@/lib/admin/audit"
import { setAppSetting } from "@/lib/app-settings"
import { assertFeature } from "@/lib/features/server"
import { resolveTimeZone } from "@/lib/timezone"
import type { ContractSpec } from "@/lib/copy/contracts"
import { BACKGROUND_SETTING, LIVE_SETTING, syncCopyRoles, cancelOrders, changeLeader, createGroup, deleteGroup, detachAccount, disableAll, flattenAll, importContract, markEventsRead, removeContract, renameGroup, retryOrder, runEngine, saveFollowers, saveLimits, saveRules, setAccountRole, setFollowerEnabled, setGroupActive, type FollowerInput, type GroupInput } from "@/lib/copy/server"
import type { CopyState, GroupLimits } from "@/lib/copy/view"

// Everything the Copy Trading pages ask the server to do. The trader is always
// the one the session resolved; the feature's release stage is checked on
// every call; and every account or group id is checked to be that trader's
// before anything is written (lib/copy/server.ts).
//
// Answers come back as { ok, ... }: a thrown server action reaches the browser
// in production as an opaque message.

export type Result<T = object> = ({ ok: true } & T) | { ok: false; error: string }
const fail = (err: unknown): { ok: false; error: string } => {
  const message = err instanceof Error ? err.message : ""
  return { ok: false, error: !message || message.startsWith("Failed query") ? "Something went wrong. Try again." : message }
}

async function who() {
  const { userId } = await assertFeature("copy_trading")
  return { userId, timeZone: resolveTimeZone(await headers()) }
}
const done = () => revalidatePath("/copy-trading", "layout")

// Fresh state for a page that is open — and the engine's heartbeat: each call
// looks at the leader of every active group and copies what changed.
export async function refreshCopy(): Promise<Result<{ state: CopyState }>> {
  try {
    const { userId, timeZone } = await who()
    return { ok: true, state: await runEngine(userId, timeZone) }
  } catch (err) {
    return fail(err)
  }
}

export async function createCopyGroup(input: GroupInput, activate: boolean): Promise<Result<{ id: number; activated: boolean; problem?: string }>> {
  try {
    const { userId, timeZone } = await who()
    const id = await createGroup(userId, { ...input, timeZone })
    let activated = false
    let problem: string | undefined
    if (activate) {
      try {
        await setGroupActive(userId, id, true, timeZone)
        activated = true
      } catch (err) {
        // the group is saved as a draft; say why it didn't start
        problem = err instanceof Error ? err.message : "It couldn't be activated."
      }
    }
    await syncCopyRoles(userId).catch(() => undefined)
    done()
    return { ok: true, id, activated, problem }
  } catch (err) {
    return fail(err)
  }
}

const act = async <T extends object = object>(run: (who: { userId: string; timeZone: string }) => Promise<T | void>): Promise<Result<T>> => {
  try {
    const me = await who()
    const result = await run(me)
    // whatever changed, the sync server is told at once which accounts are copying now
    await syncCopyRoles(me.userId).catch(() => undefined)
    done()
    return { ok: true, ...((result ?? {}) as T) }
  } catch (err) {
    return fail(err)
  }
}

export const renameCopyGroup = async (groupId: number, name: string) => act(({ userId }) => renameGroup(userId, Number(groupId), name))
export const deleteCopyGroup = async (groupId: number) => act(({ userId }) => deleteGroup(userId, Number(groupId)))
export const setCopyGroupActive = async (groupId: number, active: boolean) => act(({ userId, timeZone }) => setGroupActive(userId, Number(groupId), active === true, timeZone))
export const changeCopyLeader = async (groupId: number, accountId: number) => act(({ userId, timeZone }) => changeLeader(userId, Number(groupId), Number(accountId), timeZone))
export const saveCopyFollowers = async (groupId: number, followers: FollowerInput[], limits?: Partial<GroupLimits>) =>
  act(async ({ userId }) => {
    await saveFollowers(userId, Number(groupId), Array.isArray(followers) ? followers : [])
    if (limits) await saveLimits(userId, Number(groupId), limits)
  })
export const setCopyFollowerEnabled = async (groupId: number, accountId: number, enabled: boolean) => act(({ userId }) => setFollowerEnabled(userId, Number(groupId), Number(accountId), enabled === true))
export const saveCopyRules = async (groupId: number, rules: unknown) => act(({ userId }) => saveRules(userId, Number(groupId), rules))
export const importCopyContract = async (groupId: number, symbol: string) => act<{ contract: ContractSpec }>(async ({ userId }) => ({ contract: await importContract(userId, Number(groupId), symbol) }))
export const removeCopyContract = async (groupId: number, symbol: string) => act(({ userId }) => removeContract(userId, Number(groupId), symbol))
export const setCopyAccountRole = async (accountId: number, role: string) => act(({ userId }) => setAccountRole(userId, Number(accountId), role))
export const detachCopyAccount = async (accountId: number) => act(({ userId }) => detachAccount(userId, Number(accountId)))
export const readCopyAlerts = async () => act(({ userId }) => markEventsRead(userId))
export const retryCopyOrder = async (orderId: number) => act(({ userId, timeZone }) => retryOrder(userId, Number(orderId), timeZone))

// The emergency controls. Each is confirmed in the Cockpit first; Flatten All
// is confirmed again here, by the word the trader typed.
export const disableAllFollowers = async (groupId: number) => act(({ userId }) => disableAll(userId, Number(groupId)))
export const cancelCopyOrders = async (groupId: number) => act<{ cancelled: number }>(async ({ userId }) => ({ cancelled: await cancelOrders(userId, Number(groupId)) }))
export const flattenCopyGroup = async (groupId: number, confirm: string) => act<{ closed: number; requested: number }>(({ userId, timeZone }) => flattenAll(userId, Number(groupId), String(confirm), timeZone))

// Admin: whether the engine only works copies out (simulation) or also sends
// them to brokers (live). Off by default; recorded in the audit log.
export async function setCopyTradingLive(live: boolean): Promise<Result<{ message: string }>> {
  try {
    const admin = await assertAdmin({ team: ["manage"] })
    await setAppSetting(LIVE_SETTING, live === true)
    await logAdminAction(admin, "feature.release", null, { feature: "copy_trading", execution: live === true ? "live" : "simulation" })
    revalidatePath("/", "layout")
    return { ok: true, message: live === true ? "Copy Trading now sends follower orders to brokers." : "Copy Trading is back in simulation: nothing is sent to a broker." }
  } catch (err) {
    return fail(err)
  }
}

// Admin: whether the engine also runs on its own, from the sync server's timer,
// or only while a Copy Trading page is open. Recorded in the audit log.
export async function setCopyTradingBackground(on: boolean): Promise<Result<{ message: string }>> {
  try {
    const admin = await assertAdmin({ team: ["manage"] })
    await setAppSetting(BACKGROUND_SETTING, on === true)
    await logAdminAction(admin, "feature.release", null, { feature: "copy_trading", background: on === true })
    revalidatePath("/", "layout")
    return { ok: true, message: on === true ? "The background engine is on: groups copy without a page open." : "The background engine is off: groups copy only while a Copy Trading page is open." }
  } catch (err) {
    return fail(err)
  }
}
