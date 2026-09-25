"use client"

import type React from "react"
import { useEffect, useState, useTransition } from "react"
import Image from "next/image"
import { connectRithmic, listAvailableRithmicSystems } from "@/app/actions/rithmic"
import { brokerLogo } from "@/lib/broker-logos"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { toast } from "sonner"
import { ArrowLeft, Plus, Search } from "lucide-react"
import { useT } from "@/components/locale-provider"

// Matches lib/rithmic-client.ts's PRODUCTION_RITHMIC_GATEWAY / TEST_RITHMIC_GATEWAY
// — duplicated here since that module pulls in server-only deps (ws,
// node:fs) that can't be imported into a client component. The production
// gateway hosts every real, live prop firm on Rithmic's network — querying
// it returns the actual current list (Apex, Bulenox, Tradeify, ...), not a
// hardcoded guess. "Other" falls back to a manual gateway for firms not on
// it (or this app's own test/sim account, which lives on a separate network).
const PRODUCTION_GATEWAY = "wss://rprotocol.rithmic.com:443"
const TEST_GATEWAY = "wss://rituz00100.rithmic.com:443"
const CUSTOM = "__custom__"

// A selectable prop-firm tile in the picker grid — the firm's real logo when we
// ship one (lib/broker-logos.ts), else a monogram, styled like the reference.
function FirmTile({ name, custom, onClick }: { name: string; custom?: boolean; onClick: () => void }) {
  const t = useT()
  const logo = custom ? null : brokerLogo(name)
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex flex-col items-center gap-2.5 rounded-2xl border bg-card p-4 text-center transition-colors hover:border-primary hover:bg-accent/40"
    >
      <div className="flex size-14 items-center justify-center overflow-hidden rounded-2xl bg-muted">
        {custom ? (
          <Plus className="size-6 text-muted-foreground" />
        ) : logo ? (
          <Image src={logo} alt="" width={56} height={56} className="size-full object-cover" />
        ) : (
          <span className="text-xl font-bold text-muted-foreground">{name.charAt(0).toUpperCase()}</span>
        )}
      </div>
      <div className="min-w-0 space-y-0.5">
        <div className="truncate text-sm font-semibold">{custom ? t("Other") : name}</div>
        <div className="text-xs text-muted-foreground">{custom ? t("Custom gateway") : t("Auto Sync")}</div>
      </div>
      <span className="rounded-full border border-amber-500/40 bg-amber-500/10 px-2.5 py-0.5 text-[10px] font-semibold tracking-wide text-amber-600 uppercase dark:text-amber-400">
        {t("Futures")}
      </span>
    </button>
  )
}

export type RithmicConnected = { accounts: number; trades: number; diagnostic?: string }

// onConnected / onFailed let a host show its own success and error screens
// (the Accounts page does); without them the form reports through toasts.
export function ConnectForm({
  onDone,
  initialFirmHint,
  onConnected,
  onFailed,
}: {
  onDone: () => void
  initialFirmHint?: string
  onConnected?: (result: RithmicConnected) => void
  onFailed?: (message: string) => void
}) {
  const t = useT()
  const [systems, setSystems] = useState<string[]>([])
  const [loadingSystems, setLoadingSystems] = useState(true)
  const [step, setStep] = useState<"firm" | "details">("firm")
  const [systemChoice, setSystemChoice] = useState("")
  const [customGateway, setCustomGateway] = useState(TEST_GATEWAY)
  const [customSystemName, setCustomSystemName] = useState("")
  const [query, setQuery] = useState("")
  const [pending, startTransition] = useTransition()

  useEffect(() => {
    listAvailableRithmicSystems(PRODUCTION_GATEWAY)
      .then((list) => {
        setSystems(list)
        if (initialFirmHint) {
          const hint = initialFirmHint.toLowerCase()
          const match = list.find((s) => s.toLowerCase().includes(hint) || hint.includes(s.toLowerCase()))
          if (match) {
            setSystemChoice(match)
            setStep("details")
          }
        }
      })
      .catch(() => toast.error(t("Could not load the list of prop firms from Rithmic")))
      .finally(() => setLoadingSystems(false))
    // Only run once on mount — initialFirmHint is a one-time seed, not a live binding.
  }, [])

  const isCustom = systemChoice === CUSTOM
  const gatewayUri = isCustom ? customGateway.trim() : PRODUCTION_GATEWAY
  const systemName = isCustom ? customSystemName.trim() : systemChoice
  const canSubmit = !!systemName && !!gatewayUri

  const filtered = systems.filter((s) => s.toLowerCase().includes(query.trim().toLowerCase()))

  function selectFirm(sys: string) {
    setSystemChoice(sys)
    setStep("details")
  }

  function onConnect(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    const formData = new FormData(e.currentTarget)
    formData.set("gatewayUri", gatewayUri)
    formData.set("systemName", systemName)
    startTransition(async () => {
      try {
        const result = await connectRithmic(formData)
        if (result.ok && onConnected) {
          onConnected({ accounts: result.accounts, trades: result.trades, diagnostic: result.diagnostic })
          return
        }
        if (!result.ok && onFailed) {
          onFailed(t(result.error))
          return
        }
        if (result.ok) {
          const acct = result.accounts === 1 ? t("Rithmic connected — 1 account") : t("Rithmic connected — {n} accounts", { n: result.accounts })
          const trades = result.trades === 0 ? t("no past trades found in the last 2 years") : result.trades === 1 ? t("1 past trade imported") : t("{n} past trades imported", { n: result.trades })
          if (result.diagnostic) {
            // Always surface what Rithmic actually returned (accounts seen in
            // the fills, buy/sell split, symbols) so a mismatch is diagnosable.
            // Stays until dismissed so it can be copied/reported.
            const tone = result.trades === 0 ? toast.warning : toast.success
            tone(`${acct}, ${trades}`, { description: `Rithmic fills — ${result.diagnostic}`, duration: Infinity })
          } else {
            toast.success(`${acct}, ${trades}`)
          }
          onDone()
        } else {
          toast.error(t(result.error))
        }
      } catch {
        // A rejected promise here means the request itself failed (e.g. it
        // ran past the function's time limit) rather than a handled error.
        const message = t("Connecting took too long — Rithmic may be slow or unreachable right now. Please try again in a moment.")
        if (onFailed) onFailed(message)
        else toast.error(message)
      }
    })
  }

  // Step 1 — pick the prop firm from the ones Rithmic serves.
  if (step === "firm") {
    return (
      <div className="@container space-y-4">
        <div className="text-center">
          <h3 className="text-base font-semibold">{t("Select your prop firm")}</h3>
          <p className="text-sm text-muted-foreground">{t("Pick the prop firm your Rithmic login belongs to.")}</p>
        </div>
        <div className="relative">
          <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input value={query} onChange={(e) => setQuery(e.target.value)} placeholder={t("Search prop firm…")} className="ps-9" />
        </div>
        {loadingSystems ? (
          <div className="flex h-40 items-center justify-center text-sm text-muted-foreground">{t("Loading…")}</div>
        ) : (
          <div className="grid max-h-[52vh] grid-cols-2 gap-2.5 overflow-y-auto p-0.5 @md:grid-cols-3 @2xl:grid-cols-4">
            {filtered.map((s) => (
              <FirmTile key={s} name={s} onClick={() => selectFirm(s)} />
            ))}
            {"other".includes(query.trim().toLowerCase()) && <FirmTile name={t("Other")} custom onClick={() => selectFirm(CUSTOM)} />}
            {filtered.length === 0 && !"other".includes(query.trim().toLowerCase()) && (
              <p className="col-span-full py-6 text-center text-sm text-muted-foreground">{t("No prop firm matches — try “Other” for a custom gateway.")}</p>
            )}
          </div>
        )}
      </div>
    )
  }

  // Step 2 — account details for the selected firm.
  const selectedLogo = isCustom ? null : brokerLogo(systemChoice)
  return (
    <form onSubmit={onConnect} className="space-y-3">
      <button type="button" onClick={() => setStep("firm")} disabled={pending} className="flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground disabled:opacity-50">
        <ArrowLeft className="size-4" /> {t("Back")}
      </button>

      <div className="flex items-center gap-3 rounded-lg border p-3">
        <div className="flex size-10 items-center justify-center overflow-hidden rounded-lg bg-muted">
          {selectedLogo ? (
            <Image src={selectedLogo} alt="" width={40} height={40} className="size-full object-cover" />
          ) : (
            <span className="text-base font-bold text-muted-foreground">{(isCustom ? "?" : systemChoice.charAt(0)).toUpperCase()}</span>
          )}
        </div>
        <div className="min-w-0">
          <div className="truncate font-semibold">{isCustom ? t("Other prop firm") : systemChoice}</div>
          <div className="text-xs text-muted-foreground">{t("Rithmic · Futures · Auto Sync")}</div>
        </div>
      </div>

      {isCustom && (
        <>
          <div className="space-y-1.5">
            <Label htmlFor="rithmic-gateway">{t("Gateway address")}</Label>
            <Input id="rithmic-gateway" value={customGateway} onChange={(e) => setCustomGateway(e.target.value)} required autoComplete="off" />
            <p className="text-xs text-muted-foreground">{t("From your prop firm's connection_params.txt.")}</p>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="rithmic-system-custom">{t("System name")}</Label>
            <Input id="rithmic-system-custom" value={customSystemName} onChange={(e) => setCustomSystemName(e.target.value)} required autoComplete="off" placeholder={t("e.g. Rithmic Test")} />
          </div>
        </>
      )}

      {/* Disabled while connecting so the form can't be sent twice. */}
      <fieldset disabled={pending} className="space-y-3">
        <div className="space-y-1.5">
          <Label htmlFor="rithmic-login">{t("Username")}</Label>
          <Input id="rithmic-login" name="login" required autoComplete="off" />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="rithmic-password">{t("Password")}</Label>
          <Input id="rithmic-password" name="password" type="password" required autoComplete="off" />
        </div>
      </fieldset>
      <Button type="submit" disabled={pending || !canSubmit} className="h-11 w-full">
        {pending ? t("Connecting…") : t("Connect")}
      </Button>
      {pending && (
        <p className="text-center text-xs text-muted-foreground" role="status">
          {t("Securely checking your account and importing your history — this can take up to a minute.")}
        </p>
      )}
    </form>
  )
}
