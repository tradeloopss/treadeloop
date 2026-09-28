import { cn } from "@/lib/utils"
import { LOGO_MARK_DATA_URI } from "@/lib/brand-logo"

// The TradeLoop hexagon mark. Size it with a `size-*` class. Decorative by
// default (it sits next to the "TradeLoop" wordmark); pass `alt` where the
// mark stands alone.
//
// The mark is inlined as a data URI (lib/brand-logo) rather than fetched from
// /public: the help subdomain is served through a rewrite layer that doesn't
// expose /public, so an <img src="/logo-mark.png"> would 404 there. A plain
// <img> with a data URI always renders, on every host.
export function BrandMark({ className, alt = "" }: { className?: string; alt?: string }) {
  // eslint-disable-next-line @next/next/no-img-element
  return <img src={LOGO_MARK_DATA_URI} alt={alt} width={192} height={192} className={cn("block size-8 shrink-0", className)} />
}
