import Link from "next/link"
import { notFound } from "next/navigation"
import { ChevronRight } from "lucide-react"
import { HELP, findArticle } from "@/lib/help/content"
import { ArticleBody } from "@/components/help/help-ui"
import { appHref } from "@/lib/urls"

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

  return (
    <article className="mx-auto max-w-2xl">
      <nav className="flex items-center gap-1 text-sm text-muted-foreground">
        <Link href="/help" className="hover:text-foreground">Help</Link>
        <ChevronRight className="size-3.5" />
        <Link href={`/help/${c.slug}`} className="hover:text-foreground">{c.title}</Link>
      </nav>

      <h1 className="mt-4 text-2xl font-bold tracking-tight sm:text-3xl">{a.title}</h1>
      <p className="mt-2 text-muted-foreground">{a.summary}</p>

      <div className="mt-8">
        <ArticleBody blocks={a.body} />
      </div>

      <div className="mt-10 rounded-2xl border bg-card p-5">
        <p className="text-sm font-medium">Still need a hand?</p>
        <p className="mt-1 text-sm text-muted-foreground">Open a support ticket from inside the app and our team will help.</p>
        <a href={appHref("/support")} className="mt-3 inline-flex rounded-lg bg-primary px-3.5 py-2 text-sm font-medium text-primary-foreground transition-opacity hover:opacity-90">
          Contact support
        </a>
      </div>

      {others.length > 0 && (
        <div className="mt-10">
          <p className="mb-3 text-sm font-semibold text-muted-foreground">More in {c.title}</p>
          <div className="divide-y rounded-2xl border bg-card">
            {others.map((o) => (
              <Link key={o.slug} href={`/help/${c.slug}/${o.slug}`} className="block px-5 py-3.5 text-sm hover:bg-accent/40">
                {o.title}
              </Link>
            ))}
          </div>
        </div>
      )}
    </article>
  )
}
