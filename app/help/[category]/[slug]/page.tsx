import Link from "next/link"
import { notFound } from "next/navigation"
import { ChevronDown, ChevronRight } from "lucide-react"
import { HELP, findArticle } from "@/lib/help/content"
import { ArticleBody, headingSlug } from "@/components/help/help-ui"
import { HelpFeedback } from "@/components/help/help-feedback"
import { BrandMark } from "@/components/brand-mark"
import { ContactSupportTrigger } from "@/components/support/contact-support"

export function generateStaticParams() {
  return HELP.flatMap((c) => c.articles.map((a) => ({ category: c.slug, slug: a.slug })))
}

export async function generateMetadata({ params }: { params: Promise<{ category: string; slug: string }> }) {
  const { category, slug } = await params
  const found = findArticle(category, slug)
  return { title: found ? `${found.article.title} — TradeLoop Help` : "TradeLoop Help", description: found?.article.summary }
}

export default async function ArticlePage({ params }: { params: Promise<{ category: string; slug: string }> }) {
  const { category, slug } = await params
  const found = findArticle(category, slug)
  if (!found) notFound()
  const { category: c, article: a } = found
  const others = c.articles.filter((x) => x.slug !== a.slug)
  const headings = a.body.filter((b): b is { t: "h"; text: string } => b.t === "h").map((b) => b.text)
  const dateLabel = a.date ? new Date(a.date).toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" }) : null

  return (
    <article className="mx-auto max-w-2xl">
      <nav className="flex flex-wrap items-center gap-1 text-sm text-muted-foreground">
        <Link href="/help" className="hover:text-foreground">All Collections</Link>
        <ChevronRight className="size-3.5" />
        <Link href={`/help/${c.slug}`} className="hover:text-foreground">{c.title}</Link>
        <ChevronRight className="size-3.5" />
        <span className="text-foreground">{a.title}</span>
      </nav>

      <h1 className="mt-4 text-3xl font-bold tracking-tight sm:text-4xl">{a.title}</h1>
      <p className="mt-2 text-lg text-muted-foreground">{a.summary}</p>

      {(a.author || dateLabel) && (
        <div className="mt-5 flex items-center gap-3">
          <span className="flex size-10 items-center justify-center overflow-hidden rounded-full bg-primary/15">
            <BrandMark className="size-6" alt="TradeLoop" />
          </span>
          <div className="text-sm">
            {a.author && <p className="font-medium">Written by {a.author}</p>}
            {dateLabel && <p className="text-muted-foreground">{dateLabel}</p>}
          </div>
        </div>
      )}

      {headings.length > 1 && (
        <details className="group mt-6 rounded-xl border bg-card">
          <summary className="flex cursor-pointer items-center justify-between px-4 py-3 text-sm font-medium">
            Table of contents
            <ChevronDown className="size-4 text-muted-foreground transition-transform group-open:rotate-180" />
          </summary>
          <ul className="space-y-1 border-t px-4 py-3">
            {headings.map((h) => (
              <li key={h}>
                <a href={`#${headingSlug(h)}`} className="text-sm text-muted-foreground hover:text-primary">
                  {h}
                </a>
              </li>
            ))}
          </ul>
        </details>
      )}

      <div className="mt-8">
        <ArticleBody blocks={a.body} />
      </div>

      <div className="mt-10 rounded-2xl border bg-card p-5">
        <p className="text-sm font-medium">Still need a hand?</p>
        <p className="mt-1 text-sm text-muted-foreground">Send us a message and our team will help — no account needed.</p>
        <ContactSupportTrigger className="mt-3 inline-flex cursor-pointer rounded-lg bg-primary px-3.5 py-2 text-sm font-medium text-primary-foreground transition-opacity hover:opacity-90">
          Contact support
        </ContactSupportTrigger>
      </div>

      {others.length > 0 && (
        <div className="mt-10">
          <h2 className="mb-3 text-lg font-bold">Related Articles</h2>
          <div className="divide-y rounded-2xl border bg-card">
            {others.map((o) => (
              <Link key={o.slug} href={`/help/${c.slug}/${o.slug}`} className="flex items-center justify-between gap-3 px-5 py-3.5 text-sm hover:bg-accent/40">
                {o.title}
                <ChevronRight className="size-4 shrink-0 text-primary" />
              </Link>
            ))}
          </div>
        </div>
      )}

      <HelpFeedback />
    </article>
  )
}
