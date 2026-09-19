"use client"

import type React from "react"
import { useState } from "react"
import Link from "next/link"
import { cn } from "@/lib/utils"
import { Card } from "@/components/ui/card"
import { AccountManager, type AccountCard } from "@/components/account-manager"
import { ChangePasswordForm } from "@/components/change-password-form"
import { DangerZone } from "@/components/danger-zone"
import { SubscriptionPanel, type SubscriptionInfo } from "@/components/subscription-panel"
import { TwoFactorPanel } from "@/components/two-factor-panel"
import { User, UserRound, Settings, Lock, CreditCard, Wallet, TriangleAlert } from "lucide-react"

type Tab = "accounts" | "security" | "subscription" | "danger"

export function SettingsShell({
  accounts,
  subscription,
  isOwner,
  isPro,
  twoFactorEnabled,
  hasPassword,
}: {
  accounts: AccountCard[]
  subscription: SubscriptionInfo | null
  isOwner: boolean
  isPro: boolean
  twoFactorEnabled: boolean
  hasPassword: boolean
}) {
  const [tab, setTab] = useState<Tab>("accounts")

  return (
    <div className="flex flex-col gap-6 lg:flex-row lg:items-start">
      <Card className="w-full shrink-0 gap-5 p-4 lg:w-64">
        <div>
          <div className="flex items-center gap-1.5 px-2 pb-2 text-xs font-semibold tracking-wide text-primary uppercase">
            <UserRound className="size-3.5" /> User
          </div>
          <div className="ml-3.5 flex flex-col gap-0.5 border-l pl-3">
            <Link
              href="/profile"
              className="flex shrink-0 items-center gap-2 rounded-md px-2 py-1.5 text-sm whitespace-nowrap text-muted-foreground hover:bg-accent hover:text-foreground"
            >
              <User className="size-4" /> Profile
            </Link>
            <NavButton icon={Lock} label="Security" active={tab === "security"} onClick={() => setTab("security")} />
            <NavButton icon={CreditCard} label="Subscription" active={tab === "subscription"} onClick={() => setTab("subscription")} />
          </div>
        </div>
        <div>
          <div className="flex items-center gap-1.5 px-2 pb-2 text-xs font-semibold tracking-wide text-primary uppercase">
            <Settings className="size-3.5" /> General
          </div>
          <div className="ml-3.5 flex flex-col gap-0.5 border-l pl-3">
            <NavButton icon={Wallet} label="Accounts" active={tab === "accounts"} onClick={() => setTab("accounts")} />
            <NavButton icon={TriangleAlert} label="Danger zone" active={tab === "danger"} onClick={() => setTab("danger")} />
          </div>
        </div>
      </Card>

      <div className="min-w-0 flex-1">
        {tab === "accounts" && <AccountManager accounts={accounts} isPro={isPro || isOwner} />}
        {tab === "security" && (
          <>
            {hasPassword && <ChangePasswordForm />}
            <TwoFactorPanel enabled={twoFactorEnabled} hasPassword={hasPassword} />
          </>
        )}
        {tab === "subscription" && <SubscriptionPanel subscription={subscription} isOwner={isOwner} />}
        {tab === "danger" && <DangerZone />}
      </div>
    </div>
  )
}

function NavButton({
  icon: Icon,
  label,
  active,
  onClick,
}: {
  icon: React.ComponentType<{ className?: string }>
  label: string
  active: boolean
  onClick: () => void
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "flex shrink-0 items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm font-medium whitespace-nowrap transition-colors",
        active ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:bg-accent hover:text-foreground",
      )}
    >
      <Icon className="size-4" /> {label}
    </button>
  )
}
