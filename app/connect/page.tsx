"use client"

import { useState } from "react"

// Public pairing page (Phase 6). On the VPS the trader opens this, enters the
// "ABC-123" code from their TradeLoop dashboard, and downloads their keyed
// NinjaTrader add-on — no TradeLoop sign-in needed here. The code is the only
// credential, is single-use and expires in 10 minutes.

type Status = { kind: "idle" | "working" } | { kind: "error"; message: string } | { kind: "done"; filename: string }

export default function ConnectPage() {
  const [code, setCode] = useState("")
  const [status, setStatus] = useState<Status>({ kind: "idle" })

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (code.trim().length < 6) return setStatus({ kind: "error", message: "Enter the code shown in TradeLoop." })
    setStatus({ kind: "working" })
    try {
      const res = await fetch("/api/ninjatrader/pair", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ code }),
      })
      const data = (await res.json()) as { ok: boolean; error?: string; addon?: string; filename?: string }
      if (!res.ok || !data.ok || !data.addon) {
        return setStatus({ kind: "error", message: data.error || "That code didn't work. Generate a new one in TradeLoop." })
      }
      // Download the add-on the server built for this code.
      const blob = new Blob([data.addon], { type: "text/plain;charset=utf-8" })
      const url = URL.createObjectURL(blob)
      const a = document.createElement("a")
      a.href = url
      a.download = data.filename || "TradeLoopSync.cs"
      document.body.appendChild(a)
      a.click()
      a.remove()
      URL.revokeObjectURL(url)
      setStatus({ kind: "done", filename: data.filename || "TradeLoopSync.cs" })
    } catch {
      setStatus({ kind: "error", message: "Couldn't reach TradeLoop. Check the VPS's internet connection and try again." })
    }
  }

  return (
    <main className="mx-auto flex min-h-screen max-w-md flex-col justify-center gap-6 px-4 py-10">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Connect NinjaTrader</h1>
        <p className="mt-1 text-sm text-muted-foreground">Enter the pairing code from your TradeLoop dashboard (Accounts → Add account → Tradovate → Pair a device).</p>
      </div>

      {status.kind === "done" ? (
        <div className="rounded-xl border border-[var(--gain)]/30 bg-[var(--gain)]/5 p-4 text-sm">
          <p className="font-semibold">Add-on downloaded: {status.filename}</p>
          <ol className="mt-2 list-inside list-decimal space-y-1 text-muted-foreground">
            <li>
              Move it into <code className="rounded bg-muted px-1 py-0.5 font-mono text-xs">Documents\NinjaTrader 8\bin\Custom\AddOns</code>
            </li>
            <li>In NinjaTrader: New → NinjaScript Editor, then press F5 (or restart NinjaTrader).</li>
            <li>Your fills start appearing in TradeLoop within seconds.</li>
          </ol>
        </div>
      ) : (
        <form onSubmit={submit} className="space-y-3">
          <input
            value={code}
            onChange={(e) => setCode(e.target.value.toUpperCase())}
            placeholder="ABC-123-XYZ"
            autoComplete="off"
            autoCapitalize="characters"
            spellCheck={false}
            className="w-full rounded-lg border bg-background px-4 py-3 text-center font-mono text-xl tracking-widest outline-none focus:ring-2 focus:ring-primary"
            aria-label="Pairing code"
          />
          {status.kind === "error" && <p className="text-sm text-[var(--loss)]">{status.message}</p>}
          <button
            type="submit"
            disabled={status.kind === "working"}
            className="h-11 w-full rounded-lg bg-primary font-semibold text-primary-foreground disabled:opacity-60"
          >
            {status.kind === "working" ? "Checking…" : "Get my add-on"}
          </button>
        </form>
      )}

      <p className="text-center text-xs text-muted-foreground">Read-only. TradeLoop never stores your broker password. The add-on only reads your trades.</p>
    </main>
  )
}
