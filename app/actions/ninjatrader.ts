"use server"

import { headers } from "next/headers"
import { revalidatePath } from "next/cache"
import { auth } from "@/lib/auth"
import { requirePro } from "@/lib/subscription"
import { ninjaTraderViewFor, revokeDevice, setAccountEnabled, type NinjaTraderView } from "@/lib/ninjatrader/connections"
import { connectCredentials, disconnectCredentials, listCredentials, type NinjaCredentialView } from "@/lib/ninjatrader/credentials"

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

// Tradovate through NinjaTrader on the VPS: the trader enters their Tradovate
// login, the VPS provisions it and it syncs on its own (like MetaTrader).
export async function connectTradovateCredentials(input: { username: string; password: string; connectionKind: string }): Promise<Result<{ id: number }>> {
  const id = await userId()
  if (!id) return { ok: false, error: "Sign in again." }
  // Live broker sync is a Pro feature (Essential's one live sync is MetaTrader).
  try {
    await requirePro(id, "Tradovate sync")
  } catch {
    return { ok: false, error: "Tradovate sync is included with Pro. Upgrade in TradeLoop under Billing." }
  }
  const result = await connectCredentials(id, input)
  if (!result.ok) return result
  revalidatePath("/accounts")
  return { ok: true, value: { id: result.id } }
}

export async function getTradovateCredentialConnections(): Promise<Result<NinjaCredentialView[]>> {
  const id = await userId()
  if (!id) return { ok: false, error: "Sign in again." }
  return { ok: true, value: await listCredentials(id) }
}

export async function disconnectTradovateCredentials(connectionId: number): Promise<Result> {
  const id = await userId()
  if (!id) return { ok: false, error: "Sign in again." }
  if (!(await disconnectCredentials(id, connectionId))) return { ok: false, error: "That connection was already removed." }
  revalidatePath("/accounts")
  return { ok: true, value: undefined }
}
