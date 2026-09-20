"use client"

import type { ComponentProps } from "react"
import Link from "next/link"
import { Button } from "@/components/ui/button"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import { AccountCustomizer } from "@/components/account-customizer"
import { DashboardTemplateMenu } from "@/components/dashboard-template-menu"
import { PnlCertificateButton } from "@/components/pnl-certificate-button"
import { MoreHorizontal, ArrowRight } from "lucide-react"
import { useT } from "@/components/locale-provider"

// The dashboard's header controls. On a wide screen they sit in a row; on a
// phone the account picker stays as a compact icon button and everything else
// collapses into a "⋯" menu, so the header is a couple of round buttons that
// stay put while the page scrolls (PageHeader is sticky).
export function DashboardHeaderActions({
  account,
  template,
  certificate,
}: {
  account: ComponentProps<typeof AccountCustomizer>
  template: ComponentProps<typeof DashboardTemplateMenu>
  certificate: ComponentProps<typeof PnlCertificateButton>
}) {
  const t = useT()

  // Rendered twice — once inline for wide screens, once inside the phone menu.
  // A flex column stretches these to full width in the menu on its own.
  const secondary = (
    <>
      <DashboardTemplateMenu {...template} />
      <PnlCertificateButton {...certificate} />
      <Button
        nativeButton={false}
        render={
          <Link href="/trades">
            {t("Log a trade")} <ArrowRight className="size-4" />
          </Link>
        }
      />
    </>
  )

  return (
    <div className="flex items-center gap-2">
      <AccountCustomizer {...account} />

      <div className="hidden items-center gap-2 sm:flex">{secondary}</div>

      <Popover>
        <PopoverTrigger
          render={
            <Button variant="outline" size="icon" className="sm:hidden" aria-label={t("More actions")}>
              <MoreHorizontal className="size-4" />
            </Button>
          }
        />
        <PopoverContent align="end" className="flex w-56 flex-col gap-2 p-2">
          {secondary}
        </PopoverContent>
      </Popover>
    </div>
  )
}
