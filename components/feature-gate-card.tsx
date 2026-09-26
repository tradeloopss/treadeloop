import Link from "next/link"
import type { LucideIcon } from "lucide-react"
import { PageHeader } from "@/components/page-header"
import { Card } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { getT } from "@/lib/i18n/server"

// The screen a non-Pro user sees on a Pro-only tab: the page's own header, then
// a centered card explaining what the feature is and why it's locked, with the
// bullet points of what it does. `badge` is the pill ("Coming soon" / "Pro
// feature"); `cta` (optional) links to /pricing. Strings come in as English and
// are translated here so callers stay declarative.
export async function FeatureGateCard({
  header,
  headerDescription,
  badge,
  icon: Icon,
  title,
  intro,
  points,
  cta,
}: {
  header: string
  headerDescription: string
  badge: string
  icon: LucideIcon
  title: string
  intro: string
  points: { icon: LucideIcon; text: string }[]
  cta?: { label: string; href: string }
}) {
  const t = await getT()
  return (
    <div>
      <PageHeader title={t(header)} description={t(headerDescription)} />
      <div className="p-4 sm:p-6">
        <Card className="max-w-xl gap-5 p-6 text-center">
          <div className="mx-auto flex size-12 items-center justify-center rounded-xl bg-foreground text-background">
            <Icon className="size-6" />
          </div>
          <div className="space-y-1.5">
            <div className="inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-xs font-semibold tracking-wide text-muted-foreground uppercase">
              {t(badge)}
            </div>
            <h2 className="text-lg font-semibold">{t(title)}</h2>
            <p className="text-sm text-muted-foreground">{t(intro)}</p>
          </div>
          <ul className="space-y-2.5 text-start">
            {points.map((p, i) => {
              const PointIcon = p.icon
              return (
                <li key={i} className="flex items-start gap-2.5 text-sm">
                  <PointIcon className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
                  <span>{t(p.text)}</span>
                </li>
              )
            })}
          </ul>
          {cta && (
            <Button nativeButton={false} render={<Link href={cta.href} />} className="mx-auto hover:bg-primary/90">
              {t(cta.label)}
            </Button>
          )}
        </Card>
      </div>
    </div>
  )
}
