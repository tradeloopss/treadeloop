import { Brain, Rocket, Plug, NotebookPen, Activity, ShieldCheck, CreditCard, HelpCircle, Info, TriangleAlert, type LucideIcon } from "lucide-react"
import { cn } from "@/lib/utils"
import type { Block } from "@/lib/help/content"
import { HelpFigure } from "@/components/help/help-figures"

const ICONS: Record<string, LucideIcon> = {
  rocket: Rocket,
  plug: Plug,
  notebook: NotebookPen,
  activity: Activity,
  shield: ShieldCheck,
  card: CreditCard,
  help: HelpCircle,
  brain: Brain,
}

export function HelpIcon({ name, className }: { name: string; className?: string }) {
  const Icon = ICONS[name] ?? HelpCircle
  return <Icon className={className} />
}

// A URL-safe anchor id for a heading (shared by the body and the table of contents).
export function headingSlug(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^\w\s-]/g, "")
    .trim()
    .replace(/\s+/g, "-")
}

// Turns a YouTube/Vimeo watch URL into its embed URL; returns null for a plain
// media file (played with <video>).
function embedUrl(url: string): string | null {
  const yt = url.match(/(?:youtu\.be\/|youtube\.com\/(?:watch\?v=|embed\/|shorts\/))([\w-]{6,})/)
  if (yt) return `https://www.youtube.com/embed/${yt[1]}`
  // Vimeo — handles vimeo.com/ID, /video/ID, player URLs, and review links like
  // vimeo.com/reviews/<hash>/videos/ID (the trailing numeric id is the video).
  const vim = url.match(/vimeo\.com\/(?:.*\/)?(\d{6,})/)
  if (vim) {
    const h = url.match(/[?&]h=([\w]+)/)
    return `https://player.vimeo.com/video/${vim[1]}${h ? `?h=${h[1]}` : ""}`
  }
  return null
}

function HelpVideo({ url, title }: { url: string; title?: string }) {
  const embed = embedUrl(url)
  return (
    <div className="overflow-hidden rounded-xl border bg-black">
      {embed ? (
        <iframe
          src={embed}
          title={title ?? "Video"}
          className="aspect-video w-full"
          allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
          allowFullScreen
        />
      ) : (
        // eslint-disable-next-line jsx-a11y/media-has-caption
        <video src={url} controls className="aspect-video w-full" preload="metadata" />
      )}
    </div>
  )
}

// Renders a guide's structured body into clean, styled elements.
export function ArticleBody({ blocks }: { blocks: Block[] }) {
  return (
    <div className="space-y-5">
      {blocks.map((b, i) => {
        switch (b.t) {
          case "h":
            return (
              <h2 key={i} id={headingSlug(b.text)} className="scroll-mt-20 pt-3 text-xl font-bold tracking-tight">
                {b.text}
              </h2>
            )
          case "sub":
            return (
              <p key={i} className="-mb-2 font-semibold text-foreground">
                {b.text}
              </p>
            )
          case "p":
            return (
              <p key={i} className="leading-relaxed text-muted-foreground">
                {b.text}
              </p>
            )
          case "link":
            return (
              <p key={i} className="text-muted-foreground">
                {b.prefix ? `${b.prefix}: ` : null}
                <a href={b.href} className="font-medium text-primary underline underline-offset-2 hover:opacity-80">
                  {b.label}
                </a>
              </p>
            )
          case "list":
            return (
              <ul key={i} className="space-y-2">
                {b.items.map((it, j) => (
                  <li key={j} className="flex gap-2.5 leading-relaxed text-muted-foreground">
                    <span className="mt-2 size-1.5 shrink-0 rounded-full bg-primary" />
                    {it}
                  </li>
                ))}
              </ul>
            )
          case "steps":
            return (
              <ol key={i} className="space-y-3">
                {b.items.map((it, j) => (
                  <li key={j} className="flex gap-3 leading-relaxed">
                    <span className="flex size-6 shrink-0 items-center justify-center rounded-full bg-primary/10 text-xs font-semibold text-primary">{j + 1}</span>
                    <span className="pt-0.5 text-muted-foreground">{it}</span>
                  </li>
                ))}
              </ol>
            )
          case "video":
            return <HelpVideo key={i} url={b.url} title={b.title} />
          case "figure":
            return <HelpFigure key={i} art={b.art} caption={b.caption} />
          case "note":
          case "warn": {
            const warn = b.t === "warn"
            return (
              <div key={i} className={cn("flex gap-3 rounded-xl border p-4 text-sm", warn ? "border-amber-500/40 bg-amber-500/10 text-amber-700 dark:text-amber-300" : "border-primary/30 bg-primary/5")}>
                {warn ? <TriangleAlert className="mt-0.5 size-4 shrink-0" /> : <Info className="mt-0.5 size-4 shrink-0 text-primary" />}
                <p className="leading-relaxed">{b.text}</p>
              </div>
            )
          }
        }
      })}
    </div>
  )
}
