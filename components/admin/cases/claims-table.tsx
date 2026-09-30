"use client"

import { useMemo, useState, useTransition } from "react"
import { Search, Download, Ban, BadgeCheck } from "lucide-react"
import { cn } from "@/lib/utils"
import { revokePrize, redeemPrize, exportClaimsCsv } from "@/app/actions/admin-cases"
import type { ClaimRowView } from "@/lib/cases/queries"
import { useRouter } from "next/navigation"

const STATUS_STYLES: Record<string, string> = {
  active: "bg-emerald-500/15 text-emerald-600 dark:text-emerald-400",
  used: "bg-sky-500/15 text-sky-600 dark:text-sky-400",
  expired: "bg-muted text-muted-foreground",
  revoked: "bg-red-500/15 text-red-600 dark:text-red-400",
}

export function ClaimsTable({ dropId, claims, canManage }: { dropId: number; claims: ClaimRowView[]; canManage: boolean }) {
  const router = useRouter()
  const [q, setQ] = useState("")
  const [status, setStatus] = useState<"all" | "active" | "used" | "expired" | "revoked">("all")
  const [pending, start] = useTransition()

  const filtered = useMemo(() => {
    const term = q.trim().toLowerCase()
    return claims.filter((c) => {
      if (status !== "all" && c.status !== status) return false
      if (!term) return true
      return `${c.userName ?? ""} ${c.userEmail ?? ""} ${c.prizeCode} ${c.rewardName}`.toLowerCase().includes(term)
    })
  }, [claims, q, status])

  function act(fn: () => Promise<{ ok: boolean; error?: string }>, confirmMsg?: string) {
    if (confirmMsg && !window.confirm(confirmMsg)) return
    start(async () => {
      const res = await fn()
      if (!res.ok && res.error) alert(res.error)
      router.refresh()
    })
  }

  async function exportCsv() {
    const res = await exportClaimsCsv(dropId)
    if (!res.ok || !res.data) return
    const blob = new Blob([res.data.csv], { type: "text/csv;charset=utf-8" })
    const url = URL.createObjectURL(blob)
    const a = document.createElement("a")
    a.href = url
    a.download = `drop-${dropId}-claims.csv`
    a.click()
    URL.revokeObjectURL(url)
  }

  return (
    <div>
      <div className="flex flex-wrap items-center gap-2">
        <label className="relative flex-1 min-w-48">
          <Search className="pointer-events-none absolute start-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search user, email, code…" className="h-9 w-full rounded-lg border bg-background ps-9 pe-3 text-sm outline-none focus:border-primary" />
        </label>
        <select value={status} onChange={(e) => setStatus(e.target.value as typeof status)} className="h-9 rounded-lg border bg-background px-2.5 text-sm outline-none focus:border-primary">
          <option value="all">All statuses</option>
          <option value="active">Active</option>
          <option value="used">Used</option>
          <option value="expired">Expired</option>
          <option value="revoked">Revoked</option>
        </select>
        <button type="button" onClick={exportCsv} className="inline-flex h-9 items-center gap-1.5 rounded-lg border px-3 text-sm font-medium hover:bg-accent">
          <Download className="size-4" /> Export
        </button>
      </div>

      <p className="mt-2 text-xs text-muted-foreground">{filtered.length} of {claims.length} claims</p>

      <div className="mt-2 overflow-x-auto rounded-xl border">
        <table className="w-full text-sm">
          <thead className="border-b bg-muted/40 text-xs text-muted-foreground">
            <tr>
              <th className="px-3 py-2.5 text-start font-medium">User</th>
              <th className="px-3 py-2.5 text-start font-medium">Reward</th>
              <th className="px-3 py-2.5 text-start font-medium">Prize code</th>
              <th className="px-3 py-2.5 text-start font-medium">Claimed</th>
              <th className="px-3 py-2.5 text-start font-medium">Expires</th>
              <th className="px-3 py-2.5 text-start font-medium">Status</th>
              {canManage && <th className="px-3 py-2.5 text-end font-medium">Actions</th>}
            </tr>
          </thead>
          <tbody className="divide-y">
            {filtered.map((c) => (
              <tr key={c.id} className="hover:bg-muted/30">
                <td className="px-3 py-2.5">
                  <p className="font-medium">{c.userName ?? "—"}</p>
                  <p className="text-xs text-muted-foreground">{c.userEmail ?? c.userId}</p>
                </td>
                <td className="px-3 py-2.5">{c.rewardName}</td>
                <td className="px-3 py-2.5 font-mono text-xs">
                  {c.prizeCode}
                  {c.fulfillmentStatus === "failed" && <span className="ms-2 rounded bg-amber-500/15 px-1.5 py-0.5 font-sans text-[10px] font-semibold text-amber-600 dark:text-amber-400" title="The plan grant couldn't be provisioned automatically — grant it manually.">not provisioned</span>}
                  {c.fulfillmentStatus === "pending" && <span className="ms-2 rounded bg-sky-500/10 px-1.5 py-0.5 font-sans text-[10px] font-semibold text-sky-600 dark:text-sky-400" title="Discount codes are minted when this user starts a checkout, locked to that checkout only.">binds at checkout</span>}
                  {c.fulfillmentStatus === "fulfilled" && <span className="ms-2 rounded bg-emerald-500/10 px-1.5 py-0.5 font-sans text-[10px] font-semibold text-emerald-600 dark:text-emerald-400">provisioned</span>}
                </td>
                <td className="px-3 py-2.5 text-xs text-muted-foreground">{new Date(c.claimedAt).toLocaleDateString()}</td>
                <td className="px-3 py-2.5 text-xs text-muted-foreground">{new Date(c.expiresAt).toLocaleDateString()}</td>
                <td className="px-3 py-2.5"><span className={cn("inline-block rounded-full px-2 py-0.5 text-xs font-semibold capitalize", STATUS_STYLES[c.status])}>{c.status}</span></td>
                {canManage && (
                  <td className="px-3 py-2.5">
                    <div className="flex items-center justify-end gap-1">
                      {c.status === "active" && (
                        <button type="button" disabled={pending} onClick={() => act(() => redeemPrize(c.id), "Mark this prize as used?")} className="inline-flex items-center gap-1 rounded-md px-2 py-1 text-xs font-medium text-sky-600 hover:bg-sky-500/10 disabled:opacity-50 dark:text-sky-400" title="Mark used">
                          <BadgeCheck className="size-3.5" /> Use
                        </button>
                      )}
                      {(c.status === "active" || c.status === "used") && (
                        <button type="button" disabled={pending} onClick={() => act(() => revokePrize(c.id), "Revoke this prize? The code will stop working.")} className="inline-flex items-center gap-1 rounded-md px-2 py-1 text-xs font-medium text-destructive hover:bg-destructive/10 disabled:opacity-50" title="Revoke">
                          <Ban className="size-3.5" /> Revoke
                        </button>
                      )}
                    </div>
                  </td>
                )}
              </tr>
            ))}
            {filtered.length === 0 && (
              <tr><td colSpan={canManage ? 7 : 6} className="px-3 py-8 text-center text-sm text-muted-foreground">No claims match.</td></tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  )
}
