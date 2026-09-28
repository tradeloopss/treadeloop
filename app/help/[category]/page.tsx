import Link from "next/link"
import { notFound } from "next/navigation"
import { ArrowRight, ChevronRight } from "lucide-react"
import { HELP, findCategory } from "@/lib/help/content"
import { HelpIcon } from "@/components/help/help-ui"

export function generateStaticParams() {
  return HELP.map((c) => ({ category: c.slug }))
}

export async function generateMetadata({ params }: { params: Promise<{ category: string }> }) {
  const { category } = await params
  const c = findCategory(category)
  return { title: c ? `${c.title} — TradeLoop Help` : "TradeLoop Help" }
}

export default async function CategoryPage({ params }: { params: Promise<{ category: string }> }) {
  const { category } = await params
  const c = findCategory(category)
  if (!c) notFound()

  return (
    <div className="space-y-6">
      <nav className="flex items-center gap-1 text-sm text-muted-foreground">
        <Link href="/help" className="hover:text-foreground">Help</Link>
        <ChevronRight className="size-3.5" />
        <span className="text-foreground">{c.title}</span>
      </nav>

      <header className="flex items-center gap-3">
        <span className="flex size-12 items-center justify-center rounded-xl bg-primary/10 text-primary">
          <HelpIcon name={c.icon} className="size-6" />
        </span>
        <div>
          <h1 className="text-2xl font-bold tracking-tight">{c.title}</h1>
          <p className="text-sm text-muted-foreground">{c.description}</p>
        </div>
      </header>

      <div className="divide-y rounded-2xl border bg-card">
        {c.articles.map((a) => (
          <Link key={a.slug} href={`/help/${c.slug}/${a.slug}`} className="group flex items-center gap-3 px-5 py-4 transition-colors hover:bg-accent/40">
            <div className="min-w-0 flex-1">
              <p className="font-medium">{a.title}</p>
              <p className="truncate text-sm text-muted-foreground">{a.summary}</p>
            </div>
            <ArrowRight className="size-4 shrink-0 text-muted-foreground transition-transform group-hover:translate-x-0.5" />
          </Link>
        ))}
      </div>
    </div>
  )
}
