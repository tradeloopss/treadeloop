import Image from "next/image"
import { cn } from "@/lib/utils"

// The TradeLoop hexagon mark. Size it with a `size-*` class. Decorative by
// default (it sits next to the "TradeLoop" wordmark); pass `alt` where the
// mark stands alone.
export function BrandMark({ className, alt = "" }: { className?: string; alt?: string }) {
  return <Image src="/logo-mark.png" alt={alt} width={192} height={192} className={cn("block size-8 shrink-0", className)} />
}
