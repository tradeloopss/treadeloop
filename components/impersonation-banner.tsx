import { Eye } from "lucide-react"
import { stopImpersonating } from "@/app/actions/admin"

// Pinned above everything (including the paywall) while an admin is logged
// in as a user, so it's never unclear whose account is on screen.
export function ImpersonationBanner({ userLabel }: { userLabel: string }) {
  return (
    <div className="relative z-[60] flex shrink-0 flex-wrap items-center justify-center gap-x-4 gap-y-1 bg-[var(--chart-4)] px-4 py-2 text-sm font-medium text-black">
      <span className="flex items-center gap-2">
        <Eye className="size-4" aria-hidden="true" />
        You&apos;re logged in as {userLabel}. Everything you do happens on their account.
      </span>
      <form action={stopImpersonating}>
        <button type="submit" className="rounded-md bg-black/85 px-3 py-1 text-xs font-semibold text-white hover:bg-black">
          Return to admin
        </button>
      </form>
    </div>
  )
}
