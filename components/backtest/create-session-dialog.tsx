"use client"

import type React from "react"
import { useState, useTransition } from "react"
import { useRouter } from "next/navigation"
import { toast } from "sonner"
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Checkbox } from "@/components/ui/checkbox"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { INSTRUMENTS } from "@/lib/market-data/instruments"
import { TIMEFRAMES } from "@/lib/market-data/types"
import { createBacktestSession } from "@/app/actions/backtest"
import { cn } from "@/lib/utils"
import { useT } from "@/components/locale-provider"
import { ChevronDown, Dice5, DollarSign, Plus, Search } from "lucide-react"

export function CreateSessionDialog({ playbooks = [], trigger }: { playbooks?: { id: number; name: string }[]; trigger?: React.ReactNode }) {
  const t = useT()
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const [pending, startTransition] = useTransition()

  const [tab, setTab] = useState<"backtest" | "propfirm">("backtest")
  const [name, setName] = useState("")
  const [balance, setBalance] = useState("100000")
  const [strategy, setStrategy] = useState("")
  const [symbol, setSymbol] = useState("")
  const [assetSearch, setAssetSearch] = useState("")
  const [assetOpen, setAssetOpen] = useState(false)
  const [timeframe, setTimeframe] = useState("5m")
  const [advanced, setAdvanced] = useState(false)
  const [randomMode, setRandomMode] = useState(false)

  const selectedAsset = INSTRUMENTS.find((i) => i.symbol === symbol)
  const filteredAssets = INSTRUMENTS.filter((i) => (i.name + " " + i.symbol).toLowerCase().includes(assetSearch.trim().toLowerCase()))

  function reset() {
    setTab("backtest"); setName(""); setBalance("100000"); setStrategy(""); setSymbol(""); setAssetSearch(""); setTimeframe("5m"); setAdvanced(false); setRandomMode(false)
  }

  function onCreate() {
    if (!symbol) {
      toast.error(t("Pick an asset first"))
      return
    }
    startTransition(async () => {
      try {
        const { id } = await createBacktestSession({
          symbol,
          timeframe,
          startingBalance: Number(balance) || 100000,
          name: name.trim() || undefined,
          randomMode,
          simulatePropRules: tab === "propfirm",
          strategy: strategy || undefined,
        })
        setOpen(false)
        router.push(`/backtest/${id}`)
      } catch (err) {
        toast.error(err instanceof Error ? err.message : t("Could not create the session"))
      }
    })
  }

  return (
    <Dialog open={open} onOpenChange={(o) => { setOpen(o); if (o) reset() }}>
      <DialogTrigger render={(trigger as React.ReactElement) ?? <Button size="sm"><Plus className="size-4" /> {t("Create Session")}</Button>} />
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <div className="flex items-center justify-between gap-2">
            <DialogTitle>{t("Create a quick session")}</DialogTitle>
            <Button type="button" size="xs" variant="secondary" onClick={() => setAdvanced((a) => !a)}>
              {t("Advanced session")}
            </Button>
          </div>
        </DialogHeader>

        {/* Session type tabs */}
        <div className="flex rounded-xl border p-1">
          {(["backtest", "propfirm"] as const).map((v) => (
            <button
              key={v}
              type="button"
              onClick={() => setTab(v)}
              className={cn("flex-1 rounded-lg py-2 text-sm font-medium transition-colors", tab === v ? "bg-muted text-foreground" : "text-muted-foreground hover:text-foreground")}
            >
              {v === "backtest" ? t("Backtesting Session") : t("Prop Firm Session")}
            </button>
          ))}
        </div>

        <div className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="cs-name">{t("Name")} *</Label>
            <Input id="cs-name" value={name} onChange={(e) => setName(e.target.value)} placeholder={t("Name your session")} />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="cs-balance">{t("Account Balance")} *</Label>
            <div className="relative">
              <DollarSign className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" />
              <Input id="cs-balance" type="number" inputMode="numeric" value={balance} onChange={(e) => setBalance(e.target.value)} className="ps-9" />
            </div>
          </div>

          <div className="space-y-1.5">
            <Label>{t("Strategy")}</Label>
            <Select value={strategy} onValueChange={(v) => v && setStrategy(v)}>
              <SelectTrigger className="w-full">
                <SelectValue placeholder={t("Select a strategy or create new one")} />
              </SelectTrigger>
              <SelectContent>
                {playbooks.length === 0 ? (
                  <div className="px-2 py-1.5 text-sm text-muted-foreground">{t("No strategies yet")}</div>
                ) : (
                  playbooks.map((p) => (
                    <SelectItem key={p.id} value={p.name}>{p.name}</SelectItem>
                  ))
                )}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-1.5">
            <Label>{t("Assets")} *</Label>
            <Popover open={assetOpen} onOpenChange={setAssetOpen}>
              <PopoverTrigger
                render={
                  <button type="button" className="flex w-full items-center justify-between rounded-md border px-3 py-2 text-sm">
                    <span className={selectedAsset ? "" : "text-muted-foreground"}>
                      {selectedAsset ? `${selectedAsset.name} (${selectedAsset.symbol})` : t("Type to search for assets")}
                    </span>
                    <ChevronDown className="size-4 shrink-0 opacity-60" />
                  </button>
                }
              />
              <PopoverContent align="start" className="w-[26rem] max-w-[calc(100vw-3rem)] p-1">
                <div className="relative mb-1">
                  <Search className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" />
                  <Input value={assetSearch} onChange={(e) => setAssetSearch(e.target.value)} placeholder={t("Search…")} className="h-8 ps-8" autoFocus />
                </div>
                <div className="max-h-56 overflow-y-auto">
                  {filteredAssets.map((i) => (
                    <button
                      key={i.symbol}
                      type="button"
                      onClick={() => { setSymbol(i.symbol); setAssetOpen(false) }}
                      className="flex w-full items-center justify-between rounded px-2 py-1.5 text-sm hover:bg-accent"
                    >
                      <span>{i.name}</span>
                      <span className="text-muted-foreground">{i.symbol}</span>
                    </button>
                  ))}
                  {filteredAssets.length === 0 && <p className="px-2 py-2 text-sm text-muted-foreground">{t("No matching asset")}</p>}
                </div>
              </PopoverContent>
            </Popover>
          </div>

          <div className="space-y-1.5">
            <Label>{t("Timeframe")}</Label>
            <Select value={timeframe} onValueChange={(v) => v && setTimeframe(v)}>
              <SelectTrigger className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {TIMEFRAMES.map((tf) => (
                  <SelectItem key={tf.id} value={tf.id}>{tf.label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {advanced && (
            <label className="flex items-start gap-2.5 rounded-lg border p-3 text-sm">
              <Checkbox checked={randomMode} onCheckedChange={(c) => setRandomMode(c === true)} className="mt-0.5" />
              <span>
                <span className="flex items-center gap-1.5 font-medium">
                  <Dice5 className="size-4" /> {t("Random date")}
                </span>
                <span className="text-muted-foreground">{t("Start on a hidden historical date, so you trade without hindsight.")}</span>
              </span>
            </label>
          )}
        </div>

        <DialogFooter>
          <Button type="button" variant="ghost" onClick={() => setOpen(false)}>{t("Cancel")}</Button>
          <Button type="button" onClick={onCreate} disabled={pending || !symbol}>
            {pending ? t("Creating…") : t("Create session")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
