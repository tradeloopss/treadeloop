"use server"

import { revalidatePath } from "next/cache"
import { eq } from "drizzle-orm"
import { db } from "@/lib/db"
import { dropClaims, dropRewardSlots, dropRewards, drops } from "@/lib/db/schema"
import { assertAdmin } from "@/lib/admin/guard"
import { logAdminAction } from "@/lib/admin/audit"
import { generateSlots } from "@/lib/cases/slots"
import { validateRewards, type RewardInput } from "@/lib/cases/types"

export type DropFormInput = {
  name: string
  description?: string | null
  status: "draft" | "active"
  totalCases: number
  prizeExpirationDays: number
  startAt?: string | null
  endAt?: string | null
  rewards: RewardInput[]
}

type ActionResult<T = undefined> = { ok: true; data?: T } | { ok: false; error: string; problems?: string[] }

// The transaction handle type, so helpers can take `tx` without importing
// drizzle's internal generics.
type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0]

function toDate(v?: string | null): Date | null {
  if (!v) return null
  const d = new Date(v)
  return Number.isNaN(d.getTime()) ? null : d
}

function rewardValues(dropId: number, rewards: RewardInput[]) {
  return rewards.map((r, i) => ({
    dropId,
    name: r.name.trim(),
    type: r.type,
    discountPercent: r.type === "discount" ? (r.discountPercent ?? null) : null,
    subscriptionPlan: r.type === "free_subscription" ? (r.subscriptionPlan ?? null) : null,
    subscriptionMonths: r.type === "free_subscription" || r.type === "free_month" ? (r.subscriptionMonths ?? 1) : null,
    quantity: r.quantity,
    probability: r.probability,
    sortOrder: i,
  }))
}

// Insert a drop's rewards and the shuffled per-case slots (one row per case).
async function writeRewardsAndSlots(tx: Tx, dropId: number, rewards: RewardInput[]) {
  const insertedRewards = await tx.insert(dropRewards).values(rewardValues(dropId, rewards)).returning({ id: dropRewards.id, quantity: dropRewards.quantity })
  const slots = generateSlots(insertedRewards)
  // Chunk the slot insert so very large drops stay within parameter limits.
  const rows = slots.map((s) => ({ dropId, rewardId: s.rewardId, slotIndex: s.slotIndex, status: "available" as const }))
  for (let i = 0; i < rows.length; i += 500) await tx.insert(dropRewardSlots).values(rows.slice(i, i + 500))
}

export async function createDrop(input: DropFormInput): Promise<ActionResult<{ id: number }>> {
  const admin = await assertAdmin({ cases: ["manage"] })
  const problems = validateRewards(input.totalCases, input.rewards)
  if (problems.length) return { ok: false, error: "Please fix the drop configuration.", problems }

  const id = await db.transaction(async (tx) => {
    const [drop] = await tx
      .insert(drops)
      .values({
        name: input.name.trim() || "Untitled drop",
        description: input.description?.trim() || null,
        status: input.status,
        totalCases: input.totalCases,
        prizeExpirationDays: input.prizeExpirationDays,
        startAt: input.status === "active" ? (toDate(input.startAt) ?? new Date()) : toDate(input.startAt),
        endAt: toDate(input.endAt),
        createdBy: admin.id,
      })
      .returning({ id: drops.id })
    await writeRewardsAndSlots(tx, drop.id, input.rewards)
    return drop.id
  })

  await logAdminAction(admin, "cases.drop_create", null, { dropId: id, name: input.name, totalCases: input.totalCases })
  revalidatePath("/admin/cases")
  revalidatePath("/cases")
  return { ok: true, data: { id } }
}

export async function updateDrop(dropId: number, input: DropFormInput): Promise<ActionResult> {
  const admin = await assertAdmin({ cases: ["manage"] })
  const [drop] = await db.select().from(drops).where(eq(drops.id, dropId)).limit(1)
  if (!drop) return { ok: false, error: "Drop not found." }

  const hasClaims = drop.claimedCases > 0

  if (hasClaims) {
    // Protect the reward distribution once anyone has claimed: only metadata
    // (name, description, dates, status, future expiry) can change.
    await db
      .update(drops)
      .set({
        name: input.name.trim() || drop.name,
        description: input.description?.trim() || null,
        status: input.status,
        prizeExpirationDays: input.prizeExpirationDays,
        startAt: toDate(input.startAt) ?? drop.startAt,
        endAt: toDate(input.endAt),
        updatedAt: new Date(),
      })
      .where(eq(drops.id, dropId))
    await logAdminAction(admin, "cases.drop_update", null, { dropId, locked: true })
    revalidatePath("/admin/cases")
    revalidatePath("/cases")
    return { ok: true }
  }

  const problems = validateRewards(input.totalCases, input.rewards)
  if (problems.length) return { ok: false, error: "Please fix the drop configuration.", problems }

  await db.transaction(async (tx) => {
    await tx
      .update(drops)
      .set({
        name: input.name.trim() || "Untitled drop",
        description: input.description?.trim() || null,
        status: input.status,
        totalCases: input.totalCases,
        prizeExpirationDays: input.prizeExpirationDays,
        startAt: input.status === "active" ? (toDate(input.startAt) ?? new Date()) : toDate(input.startAt),
        endAt: toDate(input.endAt),
        updatedAt: new Date(),
      })
      .where(eq(drops.id, dropId))
    // No claims yet — safe to rebuild the reward set and re-shuffle the slots.
    await tx.delete(dropRewardSlots).where(eq(dropRewardSlots.dropId, dropId))
    await tx.delete(dropRewards).where(eq(dropRewards.dropId, dropId))
    await writeRewardsAndSlots(tx, dropId, input.rewards)
  })

  await logAdminAction(admin, "cases.drop_update", null, { dropId })
  revalidatePath("/admin/cases")
  revalidatePath("/cases")
  return { ok: true }
}

async function setStatus(dropId: number, status: "active" | "paused" | "ended" | "draft", action: "cases.drop_publish" | "cases.drop_pause" | "cases.drop_resume" | "cases.drop_end"): Promise<ActionResult> {
  const admin = await assertAdmin({ cases: ["manage"] })
  const [drop] = await db.select().from(drops).where(eq(drops.id, dropId)).limit(1)
  if (!drop) return { ok: false, error: "Drop not found." }

  // Slots are always generated at create time (even for drafts), so a status
  // change is just a metadata update.
  await db
    .update(drops)
    .set({ status, startAt: status === "active" && !drop.startAt ? new Date() : drop.startAt, updatedAt: new Date() })
    .where(eq(drops.id, dropId))

  await logAdminAction(admin, action, null, { dropId, status })
  revalidatePath("/admin/cases")
  revalidatePath("/cases")
  return { ok: true }
}

export async function publishDrop(dropId: number) {
  return setStatus(dropId, "active", "cases.drop_publish")
}
export async function pauseDrop(dropId: number) {
  return setStatus(dropId, "paused", "cases.drop_pause")
}
export async function resumeDrop(dropId: number) {
  return setStatus(dropId, "active", "cases.drop_resume")
}
export async function endDrop(dropId: number) {
  return setStatus(dropId, "ended", "cases.drop_end")
}

export async function duplicateDrop(dropId: number): Promise<ActionResult<{ id: number }>> {
  const admin = await assertAdmin({ cases: ["manage"] })
  const [drop] = await db.select().from(drops).where(eq(drops.id, dropId)).limit(1)
  if (!drop) return { ok: false, error: "Drop not found." }
  const rewards = await db.select().from(dropRewards).where(eq(dropRewards.dropId, dropId)).orderBy(dropRewards.sortOrder)

  const id = await db.transaction(async (tx) => {
    const [copy] = await tx
      .insert(drops)
      .values({
        name: `${drop.name} (copy)`,
        description: drop.description,
        status: "draft",
        totalCases: drop.totalCases,
        prizeExpirationDays: drop.prizeExpirationDays,
        createdBy: admin.id,
      })
      .returning({ id: drops.id })
    await writeRewardsAndSlots(
      tx,
      copy.id,
      rewards.map((r) => ({
        name: r.name,
        type: r.type as RewardInput["type"],
        discountPercent: r.discountPercent,
        subscriptionPlan: r.subscriptionPlan,
        subscriptionMonths: r.subscriptionMonths,
        quantity: r.quantity,
        probability: r.probability,
      })),
    )
    return copy.id
  })

  await logAdminAction(admin, "cases.drop_duplicate", null, { fromDropId: dropId, newDropId: id })
  revalidatePath("/admin/cases")
  return { ok: true, data: { id } }
}

export async function deleteDrop(dropId: number): Promise<ActionResult> {
  const admin = await assertAdmin({ cases: ["manage"] })
  await db.transaction(async (tx) => {
    await tx.delete(dropClaims).where(eq(dropClaims.dropId, dropId))
    await tx.delete(dropRewardSlots).where(eq(dropRewardSlots.dropId, dropId))
    await tx.delete(dropRewards).where(eq(dropRewards.dropId, dropId))
    await tx.delete(drops).where(eq(drops.id, dropId))
  })
  await logAdminAction(admin, "cases.drop_delete", null, { dropId })
  revalidatePath("/admin/cases")
  revalidatePath("/cases")
  return { ok: true }
}

export async function revokePrize(claimId: number): Promise<ActionResult> {
  const admin = await assertAdmin({ cases: ["manage"] })
  const [claim] = await db.select().from(dropClaims).where(eq(dropClaims.id, claimId)).limit(1)
  if (!claim) return { ok: false, error: "Claim not found." }
  await db.update(dropClaims).set({ status: "revoked" }).where(eq(dropClaims.id, claimId))
  await logAdminAction(admin, "cases.prize_revoke", claim.userId, { claimId, prizeCode: claim.prizeCode })
  revalidatePath("/admin/cases")
  return { ok: true }
}

export async function redeemPrize(claimId: number): Promise<ActionResult> {
  const admin = await assertAdmin({ cases: ["manage"] })
  const [claim] = await db.select().from(dropClaims).where(eq(dropClaims.id, claimId)).limit(1)
  if (!claim) return { ok: false, error: "Claim not found." }
  if (claim.status === "revoked") return { ok: false, error: "This prize was revoked." }
  if (claim.status === "used") return { ok: false, error: "This prize was already used." }
  if (claim.expiresAt.getTime() <= Date.now()) return { ok: false, error: "This prize has expired." }
  await db.update(dropClaims).set({ status: "used", redeemedAt: new Date() }).where(eq(dropClaims.id, claimId))
  await logAdminAction(admin, "cases.prize_redeem", claim.userId, { claimId, prizeCode: claim.prizeCode })
  revalidatePath("/admin/cases")
  return { ok: true }
}

// CSV export of a drop's claims (returned as a string the client downloads).
export async function exportClaimsCsv(dropId: number): Promise<ActionResult<{ csv: string }>> {
  await assertAdmin({ cases: ["view"] })
  const { listClaims } = await import("@/lib/cases/queries")
  const claims = await listClaims(dropId, 100000)
  const header = ["User", "Email", "Reward", "Prize code", "Claimed at", "Expires at", "Redeemed at", "Status"]
  const esc = (v: string) => `"${v.replace(/"/g, '""')}"`
  const lines = [header.map(esc).join(",")]
  for (const c of claims) {
    lines.push(
      [c.userName ?? "", c.userEmail ?? "", c.rewardName, c.prizeCode, c.claimedAt.toISOString(), c.expiresAt.toISOString(), c.redeemedAt?.toISOString() ?? "", c.status]
        .map((v) => esc(String(v)))
        .join(","),
    )
  }
  return { ok: true, data: { csv: lines.join("\n") } }
}
