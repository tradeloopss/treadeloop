import Link from "next/link"
import { ArrowRight } from "lucide-react"
import { HELP } from "@/lib/help/content"
import { HelpIcon } from "@/components/help/help-ui"
import { HelpSearch } from "@/components/help/help-search"

export default function HelpHome() {
  const searchItems = HELP.flatMap((c) =>
    c.articles.map((a) => ({ title: a.title, summary: a.summary, category: c.title, href: `/help/${c.slug}/${a.slug}` })),
  )

  return (
    <div className="space-y-10">
      <section className="text-center">
        <h1 className="text-3xl font-bold tracking-tight sm:text-4xl">How can we help?</h1>
        <p className="mx-auto mt-2 max-w-xl text-muted-foreground">Guides and answers for getting the most out of TradeLoop.</p>
        <div className="mx-auto mt-6 max-w-xl">
          <HelpSearch items={searchItems} />
        </div>
      </section>

      <section className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {HELP.map((c) => (
          <Link key={c.slug} href={`/help/${c.slug}`} className="group rounded-2xl border bg-card p-5 transition-colors hover:border-primary/40">
            <span className="flex size-11 items-center justify-center rounded-xl bg-primary/10 text-primary">
              <HelpIcon name={c.icon} className="size-5" />
            </span>
            <h2 className="mt-3 font-semibold">{c.title}</h2>
            <p className="mt-1 text-sm text-muted-foreground">{c.description}</p>
            <span className="mt-3 inline-flex items-center gap-1 text-sm font-medium text-primary">
              {c.articles.length} {c.articles.length === 1 ? "guide" : "guides"}
              <ArrowRight className="size-3.5 transition-transform group-hover:translate-x-0.5" />
            </span>
          </Link>
        ))}
      </section>
    </div>
  )
}
