"use client"

import Link from "next/link"
import { Card } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Link2, Lock } from "lucide-react"
import { useT } from "@/components/locale-provider"

export function LiveSyncUpgradeBanner({ title, description }: { title: string; description: string }) {
  const t = useT()
  return (
    <Card className="flex flex-col items-start gap-4 p-5 sm:flex-row sm:items-center sm:justify-between">
      <div className="flex items-center gap-4">
        <div className="flex size-12 shrink-0 items-center justify-center rounded-xl bg-blue-500/10 text-blue-500">
          <Link2 className="size-5" />
        </div>
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <h2 className="font-semibold">{title}</h2>
            <span className="inline-flex items-center rounded-full border border-violet-500/30 bg-violet-500/10 px-2.5 py-0.5 text-[10px] font-semibold tracking-wide text-violet-500 uppercase">
              Pro
            </span>
          </div>
          <p className="mt-1 max-w-xl text-sm text-muted-foreground">{description}</p>
        </div>
      </div>
      <Button
        className="w-full shrink-0 bg-gradient-to-r from-violet-600 to-fuchsia-500 sm:w-auto"
        nativeButton={false}
        render={
          <Link href="/pricing">
            <Lock className="size-4" /> {t("Upgrade to Pro")}
          </Link>
        }
      />
    </Card>
  )
}
