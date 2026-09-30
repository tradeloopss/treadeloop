import { randomInt } from "node:crypto"

// Expand each reward into `quantity` slots, then shuffle the whole set with a
// crypto Fisher–Yates so the per-case reward order is uniformly random. The
// result is inserted as drop_reward_slots, one row per case — which is what
// makes the final distribution exactly the configured quantities.
export function generateSlots(rewards: { id: number; quantity: number }[]): { rewardId: number; slotIndex: number }[] {
  const pool: number[] = []
  for (const r of rewards) for (let i = 0; i < r.quantity; i++) pool.push(r.id)
  for (let i = pool.length - 1; i > 0; i--) {
    const j = randomInt(i + 1)
    ;[pool[i], pool[j]] = [pool[j], pool[i]]
  }
  return pool.map((rewardId, idx) => ({ rewardId, slotIndex: idx + 1 }))
}
