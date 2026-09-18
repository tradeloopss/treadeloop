import { PricingPlans } from "@/components/pricing-plans"
import { TrendingUp, ShieldCheck } from "lucide-react"
import Link from "next/link"

export default async function PricingPage({
  searchParams,
}: {
  searchParams: Promise<{ required?: string }>
}) {
  const { required } = await searchParams

  return (
    <div className="min-h-svh bg-gradient-to-b from-background to-accent/20 px-4 py-16">
      <div className="mx-auto mb-6 flex max-w-5xl items-center justify-center gap-2">
        <Link href="/" className="flex items-center gap-2">
          <div className="flex size-8 items-center justify-center rounded-lg bg-primary text-primary-foreground">
            <TrendingUp className="size-5" />
          </div>
          <span className="text-lg font-semibold tracking-tight">TradeLoop</span>
        </Link>
      </div>

      {required && (
        <div className="mx-auto mb-10 max-w-3xl text-balance rounded-xl border-2 border-primary/40 bg-primary/10 px-6 py-4 text-center text-base font-medium text-foreground shadow-sm sm:text-lg">
          Pick a plan to start your free trial — you&apos;re one step away from your journal.
        </div>
      )}

      <h1 className="text-center text-3xl font-semibold tracking-tight sm:text-4xl">
        Find the plan that fits your trading
      </h1>
      <p className="mx-auto mt-3 max-w-md text-center text-sm text-muted-foreground">
        Every plan starts with a free trial — no charge today, cancel anytime before it ends.
      </p>

      <PricingPlans />

      <div className="mx-auto mt-10 flex max-w-lg flex-col items-center gap-2 text-center text-xs text-muted-foreground sm:flex-row sm:justify-center sm:gap-6">
        <span className="flex items-center gap-1.5">
          <ShieldCheck className="size-3.5" /> No charge until your trial ends
        </span>
        <span className="flex items-center gap-1.5">
          <ShieldCheck className="size-3.5" /> Cancel anytime, no questions asked
        </span>
      </div>
    </div>
  )
}
