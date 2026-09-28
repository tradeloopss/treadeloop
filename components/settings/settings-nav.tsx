"use client"

import Link from "next/link"
import { usePathname } from "next/navigation"
import { toast } from "sonner"
import {
  User,
  ShieldCheck,
  Lock,
  Palette,
  Wallet,
  Copy,
  Tags,
  LayoutTemplate,
  FileSpreadsheet,
  Calculator,
  Layers,
  SlidersHorizontal,
  Bell,
  FileCheck,
  Sparkles,
  CreditCard,
} from "lucide-react"
import { cn } from "@/lib/utils"
import { useT } from "@/components/locale-provider"

type Item = {
  label: string
  href?: string
  icon: React.ComponentType<{ className?: string }>
  soon?: string // toast message; presence marks the item as coming-soon
}
type Section = { label: string; badge?: string; items: Item[] }

// Mirrors the reference settings navigation exactly. API is intentionally
// absent (removed). Copy Trading and the whole AI & DATA section are
// coming-soon: they render subdued and only fire a toast.
const SECTIONS: Section[] = [
  {
    label: "Account",
    items: [
      { label: "Profile", href: "/settings/profile", icon: User },
      { label: "Security", href: "/settings/security", icon: ShieldCheck },
      { label: "Privacy", href: "/settings/privacy", icon: Lock },
    ],
  },
  {
    label: "Appearance",
    items: [{ label: "Theme", href: "/settings/theme", icon: Palette }],
  },
  {
    label: "Trading",
    items: [
      { label: "Accounts", href: "/settings/accounts", icon: Wallet },
      { label: "Copy Trading", icon: Copy, soon: "Copy Trading is coming soon." },
      { label: "Tags", href: "/settings/tags", icon: Tags },
      { label: "Trade Templates", href: "/settings/trade-templates", icon: LayoutTemplate },
      { label: "CSV Schemas", href: "/settings/csv-schemas", icon: FileSpreadsheet },
      { label: "Calculations", href: "/settings/calculations", icon: Calculator },
      { label: "Order Grouping", href: "/settings/order-grouping", icon: Layers },
    ],
  },
  {
    label: "General",
    items: [
      { label: "Preferences", href: "/settings/preferences", icon: SlidersHorizontal },
      { label: "Notifications", href: "/settings/notifications", icon: Bell },
    ],
  },
  {
    label: "AI & Data",
    badge: "Soon",
    items: [
      { label: "Consent", icon: FileCheck, soon: "AI & Data features are coming soon." },
      { label: "AI Settings", icon: Sparkles, soon: "AI & Data features are coming soon." },
    ],
  },
  {
    label: "Billing",
    items: [{ label: "Subscription", href: "/settings/subscription", icon: CreditCard }],
  },
]

export function SettingsNav() {
  const pathname = usePathname()
  const t = useT()

  return (
    <nav className="flex shrink-0 gap-6 overflow-x-auto pb-2 lg:w-52 lg:flex-col lg:gap-5 lg:overflow-visible lg:pb-0">
      {SECTIONS.map((section) => (
        <div key={section.label} className="shrink-0">
          <div className="flex items-center gap-1.5 px-2 pb-1.5">
            <span className="text-[11px] font-semibold tracking-wider text-muted-foreground/70 uppercase">{t(section.label)}</span>
            {section.badge && (
              <span className="rounded-full border px-1 py-px text-[8px] font-semibold tracking-wide text-muted-foreground/70 uppercase">
                {t(section.badge)}
              </span>
            )}
          </div>
          <div className="flex gap-0.5 lg:flex-col">
            {section.items.map((item) => {
              const Icon = item.icon
              const active = item.href ? pathname === item.href : false
              if (item.soon) {
                return (
                  <button
                    key={item.label}
                    type="button"
                    onClick={() => toast(t(item.soon!))}
                    className="flex items-center gap-2 rounded-md px-2 py-1.5 text-start text-[13px] whitespace-nowrap text-muted-foreground/50 transition-colors hover:text-muted-foreground"
                  >
                    <Icon className="size-3.5 shrink-0" />
                    {t(item.label)}
                    <span className="ms-auto hidden rounded-full border px-1 py-px text-[8px] font-semibold tracking-wide uppercase lg:inline">
                      {t("Soon")}
                    </span>
                  </button>
                )
              }
              return (
                <Link
                  key={item.label}
                  href={item.href!}
                  className={cn(
                    "flex items-center gap-2 rounded-md px-2 py-1.5 text-[13px] whitespace-nowrap transition-colors",
                    active ? "bg-accent font-medium text-foreground" : "text-muted-foreground hover:text-foreground",
                  )}
                >
                  <Icon className="size-3.5 shrink-0" />
                  {t(item.label)}
                </Link>
              )
            })}
          </div>
        </div>
      ))}
    </nav>
  )
}
