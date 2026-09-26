"use server"

import { headers } from "next/headers"
import { revalidatePath } from "next/cache"
import { auth } from "@/lib/auth"
import { ninjaTraderViewFor, revokeDevice, setAccountEnabled, type NinjaTraderView } from "@/lib/ninjatrader/connections"

// The NinjaTrader add-on in the Add account window and on Accounts. Results,
// not exceptions: Next hides thrown messages in production.

type Result<T = undefined> = { ok: true; value: T } | { ok: false; error: string }

async function userId(): Promise<string | null> {
  const session = await auth.api.getSession({ headers: await headers() })
  return session?.user?.id ?? null
}

export async function getNinjaTraderStatus(): Promise<Result<NinjaTraderView>> {
  const id = await userId()
  if (!id) return { ok: false, error: "Sign in again." }
  return { ok: true, value: await ninjaTraderViewFor(id) }
}

export async function removeNinjaTraderAddOn(deviceId: number): Promise<Result> {
  const id = await userId()
  if (!id) return { ok: false, error: "Sign in again." }
  if (!(await revokeDevice(id, deviceId))) return { ok: false, error: "That add-on was already removed." }
  revalidatePath("/accounts")
  return { ok: true, value: undefined }
}

export async function setNinjaTraderAccountSync(rowId: number, enabled: boolean): Promise<Result> {
  const id = await userId()
  if (!id) return { ok: false, error: "Sign in again." }
  if (!(await setAccountEnabled(id, rowId, enabled))) return { ok: false, error: "That account isn't connected." }
  revalidatePath("/accounts")
  return { ok: true, value: undefined }
}
