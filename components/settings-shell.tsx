"use client"

import type React from "react"
import { useState } from "react"
import Link from "next/link"
import { cn } from "@/lib/utils"
import { Card } from "@/components/ui/card"
import { ChangePasswordForm } from "@/components/change-password-form"
import { DangerZone } from "@/components/danger-zone"
import { TwoFactorPanel } from "@/components/two-factor-panel"
import { User, UserRound, Settings, Lock, CreditCard, Wallet, TriangleAlert } from "lucide-react"
import { useT } from "@/components/locale-provider"

type Tab = "security" | "danger"

export function SettingsShell({ twoFactorEnabled, hasPassword }: { twoFactorEnabled: boolean; hasPassword: boolean }) {
  const t = useT()
  const [tab, setTab] = useState<Tab>("security")

  return (
    <div className="flex flex-col gap-6 lg:flex-row lg:items-start">
      <Card className="w-full shrink-0 gap-5 p-4 lg:w-64">
        <div>
          <div className="flex items-center gap-1.5 px-2 pb-2 text-xs font-semibold tracking-wide text-primary uppercase">
            <UserRound className="size-3.5" /> {t("User")}
          </div>
          <div className="ms-3.5 flex flex-col gap-0.5 border-s ps-3">
            <Link
              href="/profile"
              className="flex shrink-0 items-center gap-2 rounded-md px-2 py-1.5 text-sm whitespace-nowrap text-muted-foreground hover:bg-accent hover:text-foreground"
            >
              <User className="size-4" /> {t("Profile")}
            </Link>
            <NavButton icon={Lock} label={t("Security")} active={tab === "security"} onClick={() => setTab("security")} />
            {/* Plan, payments and cards have their own page. */}
            <Link
              href="/billing"
              className="flex shrink-0 items-center gap-2 rounded-md px-2 py-1.5 text-sm whitespace-nowrap text-muted-foreground hover:bg-accent hover:text-foreground"
            >
              <CreditCard className="size-4" /> {t("Billing & subscription")}
            </Link>
          </div>
        </div>
        <div>
          <div className="flex items-center gap-1.5 px-2 pb-2 text-xs font-semibold tracking-wide text-primary uppercase">
            <Settings className="size-3.5" /> {t("General")}
          </div>
          <div className="ms-3.5 flex flex-col gap-0.5 border-s ps-3">
            {/* Accounts has its own page: connections, sync health, editing. */}
            <Link
              href="/accounts"
              className="flex shrink-0 items-center gap-2 rounded-md px-2 py-1.5 text-sm font-medium whitespace-nowrap text-muted-foreground hover:bg-accent hover:text-foreground"
            >
              <Wallet className="size-4" /> {t("Accounts")}
            </Link>
            <NavButton icon={TriangleAlert} label={t("Danger zone")} active={tab === "danger"} onClick={() => setTab("danger")} />
          </div>
        </div>
      </Card>

      <div className="min-w-0 flex-1">
        {tab === "security" && (
          <>
            {hasPassword && <ChangePasswordForm />}
            <TwoFactorPanel enabled={twoFactorEnabled} hasPassword={hasPassword} />
          </>
        )}
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
        "flex shrink-0 items-center gap-2 rounded-md px-2 py-1.5 text-start text-sm font-medium whitespace-nowrap transition-colors",
        active ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:bg-accent hover:text-foreground",
      )}
    >
      <Icon className="size-4" /> {label}
    </button>
  )
}
