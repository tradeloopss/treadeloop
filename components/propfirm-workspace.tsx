"use client"

import { useState } from "react"
import type { PropFirmAccount, PropFirmTransaction } from "@/app/actions/propfirm"
import { buildPropFirmDashboard } from "@/lib/propfirm-dashboard"
import { PropFirmDashboard } from "@/components/propfirm-dashboard"
import { PropFirmTracker, LogTransactionForm } from "@/components/propfirm-tracker"
import { PropFirmTransactions } from "@/components/propfirm-transactions"
import { TrackPropFirmWizard } from "@/components/track-propfirm-wizard"
import { FundedAccountsDashboard, type FundedTrade } from "@/components/funded-accounts-dashboard"
import { EvaluationAccountsDashboard } from "@/components/evaluation-accounts-dashboard"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { Button } from "@/components/ui/button"
import { Label } from "@/components/ui/label"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Receipt } from "lucide-react"

type DateRange = "all" | "30d" | "90d" | "12m"

function rangeStartDate(range: DateRange): Date | null {
  if (range === "all") return null
  const d = new Date()
  if (range === "30d") d.setDate(d.getDate() - 30)
  else if (range === "90d") d.setDate(d.getDate() - 90)
  else d.setFullYear(d.getFullYear() - 1)
  return d
}

export function PropFirmWorkspace({
  accounts: allAccounts,
  transactions,
  fundedTrades,
  evaluationTrades,
  isPro,
}: {
  accounts: PropFirmAccount[]
  transactions: PropFirmTransaction[]
  fundedTrades: FundedTrade[]
  evaluationTrades: FundedTrade[]
  isPro: boolean
}) {
  const [range, setRange] = useState<DateRange>("all")
  const [accountFilter, setAccountFilter] = useState<"all" | number>("all")
  const [payoutOpen, setPayoutOpen] = useState(false)
  const [payoutAccountId, setPayoutAccountId] = useState<number | null>(null)

  // Everything in this tracker is scoped to accounts that are actually being
  // tracked as prop firm accounts (have rules attached) — a plain trading
  // account that was never set up here has nothing to show in any of these
  // tabs. It can still be attached via "Track prop firm account" -> Manual
  // entry -> Existing account (see track-propfirm-wizard.tsx).
  const accounts = allAccounts.filter((a) => a.rules != null)

  const scopedAccounts = accountFilter === "all" ? accounts : accounts.filter((a) => a.id === accountFilter)
  const scopedAccountIds = new Set(scopedAccounts.map((a) => a.id))
  const rangeStartAt = rangeStartDate(range)
  const scopedTransactions = transactions.filter(
    (t) => scopedAccountIds.has(t.accountId) && (!rangeStartAt || new Date(t.occurredAt) >= rangeStartAt)
  )
  const dashboardData = buildPropFirmDashboard(scopedAccounts, scopedTransactions)
  const currency = scopedAccounts[0]?.currency ?? accounts[0]?.currency ?? "USD"

  const selectedPayoutAccount = accounts.find((a) => a.id === payoutAccountId) ?? null

  return (
    <div>
      <div className="flex flex-wrap items-end justify-between gap-4 border-b px-4 py-4 sm:px-6 sm:py-5">
        <div>
          <h1 className="text-xl font-semibold tracking-tight">Prop Firm Tracker</h1>
          <p className="mt-1 text-sm text-muted-foreground">Here&apos;s an overview of your prop firm activity</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Select value={range} onValueChange={(v) => v && setRange(v as DateRange)}>
            <SelectTrigger size="sm"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All time</SelectItem>
              <SelectItem value="30d">Last 30 days</SelectItem>
              <SelectItem value="90d">Last 90 days</SelectItem>
              <SelectItem value="12m">Last 12 months</SelectItem>
            </SelectContent>
          </Select>
          <Select value={accountFilter === "all" ? "all" : String(accountFilter)} onValueChange={(v) => setAccountFilter(v === "all" || !v ? "all" : Number(v))}>
            <SelectTrigger size="sm"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All accounts</SelectItem>
              {accounts.map((a) => (
                <SelectItem key={a.id} value={String(a.id)}>{a.name}</SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Button variant="outline" size="sm" onClick={() => setPayoutOpen(true)}>
            <Receipt className="size-4" /> Log payout
          </Button>
          <TrackPropFirmWizard accounts={allAccounts} isPro={isPro} />
        </div>
      </div>

      <div className="p-4 sm:p-6">
        <Tabs defaultValue="dashboard">
          <TabsList>
            <TabsTrigger value="dashboard">Dashboard</TabsTrigger>
            <TabsTrigger value="evaluation">Evaluation</TabsTrigger>
            <TabsTrigger value="funded">Funded</TabsTrigger>
            <TabsTrigger value="accounts">Accounts</TabsTrigger>
            <TabsTrigger value="transactions">Transactions</TabsTrigger>
          </TabsList>
          <TabsContent value="dashboard" className="mt-4">
            <PropFirmDashboard data={dashboardData} currency={currency} />
          </TabsContent>
          <TabsContent value="evaluation" className="mt-4">
            <EvaluationAccountsDashboard accounts={scopedAccounts} trades={evaluationTrades} currency={currency} />
          </TabsContent>
          <TabsContent value="funded" className="mt-4">
            <FundedAccountsDashboard accounts={scopedAccounts} trades={fundedTrades} currency={currency} />
          </TabsContent>
          <TabsContent value="accounts" className="mt-4">
            <PropFirmTracker accounts={scopedAccounts} />
          </TabsContent>
          <TabsContent value="transactions" className="mt-4">
            <PropFirmTransactions transactions={scopedTransactions} accounts={scopedAccounts} currency={currency} />
          </TabsContent>
        </Tabs>
      </div>

      <Dialog
        open={payoutOpen}
        onOpenChange={(v) => {
          setPayoutOpen(v)
          if (!v) setPayoutAccountId(null)
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Log a fee or payout</DialogTitle>
            <DialogDescription>Powers the financial dashboard&apos;s spend/earn/ROI totals.</DialogDescription>
          </DialogHeader>
          <div className="space-y-1.5">
            <Label>Account</Label>
            <Select value={payoutAccountId != null ? String(payoutAccountId) : ""} onValueChange={(v) => setPayoutAccountId(v ? Number(v) : null)}>
              <SelectTrigger className="w-full"><SelectValue placeholder="Choose an account…" /></SelectTrigger>
              <SelectContent>
                {accounts.map((a) => (
                  <SelectItem key={a.id} value={String(a.id)}>{a.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          {selectedPayoutAccount && (
            <LogTransactionForm
              account={selectedPayoutAccount}
              onDone={() => {
                setPayoutOpen(false)
                setPayoutAccountId(null)
              }}
            />
          )}
        </DialogContent>
      </Dialog>
    </div>
  )
}
