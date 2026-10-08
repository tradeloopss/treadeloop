"use server"

import { headers } from "next/headers"
import { auth } from "@/lib/auth"
import { resolveTimeZone } from "@/lib/timezone"
import { createCard, deleteCard, getCard, listCards, updateCard } from "@/lib/pnl-cards/server"
import { cleanDesign, type PnlCardScope, type PnlCardSummary, type PnlCardView } from "@/lib/pnl-cards/model"

// PNL Cards: what the editor asks the server to do (lib/pnl-cards/server.ts).
// The trader is the one the session resolved, every card is checked to be
// theirs, and the accounts a card is of are worked out on the server from
// them: an id sent from the page is never taken on trust.
//
// Answers come back as { ok, ... }: a thrown server action reaches the browser
// in production as an opaque message.

export type CardResult<T = object> = ({ ok: true } & T) | { ok: false; error: string }
const fail = (err: unknown, fallback: string): { ok: false; error: string } => {
  const message = err instanceof Error ? err.message : ""
  return { ok: false, error: !message || message.startsWith("Failed query") ? fallback : message }
}
async function me() {
  const h = await headers()
  const session = await auth.api.getSession({ headers: h })
  if (!session?.user) throw new Error("Sign in to continue.")
  return { userId: session.user.id, timeZone: resolveTimeZone(h) }
}

export async function createPnlCard(input: { scope: PnlCardScope; period?: string; layout?: string; design?: string }): Promise<CardResult<{ card: PnlCardView }>> {
  try {
    const { userId, timeZone } = await me()
    return { ok: true, card: await createCard(userId, { scope: input?.scope, period: input?.period, layout: input?.layout, design: input?.design }, timeZone) }
  } catch (err) {
    return fail(err, "Unable to create PNL card. Please try again.")
  }
}

export async function updatePnlCard(id: number, patch: { layout?: string; visibility?: Record<string, boolean>; privacy?: string }): Promise<CardResult<{ card: PnlCardView }>> {
  try {
    const { userId } = await me()
    return { ok: true, card: await updateCard(userId, Number(id), { layout: patch?.layout, visibility: patch?.visibility, privacy: patch?.privacy }) }
  } catch (err) {
    return fail(err, "Unable to save the card. Please try again.")
  }
}

export async function deletePnlCard(id: number): Promise<CardResult> {
  try {
    const { userId } = await me()
    await deleteCard(userId, Number(id))
    return { ok: true }
  } catch (err) {
    return fail(err, "Unable to delete the card. Please try again.")
  }
}

export async function openPnlCard(id: number): Promise<CardResult<{ card: PnlCardView }>> {
  try {
    const { userId } = await me()
    return { ok: true, card: await getCard(userId, Number(id)) }
  } catch (err) {
    return fail(err, "Unable to open the card. Please try again.")
  }
}

export async function listPnlCards(design?: string): Promise<CardResult<{ cards: PnlCardSummary[] }>> {
  try {
    const { userId } = await me()
    return { ok: true, cards: await listCards(userId, cleanDesign(design)) }
  } catch (err) {
    return fail(err, "Unable to load your cards.")
  }
}
