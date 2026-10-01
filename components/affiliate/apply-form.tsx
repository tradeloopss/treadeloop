"use client"

import { useState } from "react"
import { useRouter } from "next/navigation"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Textarea } from "@/components/ui/textarea"
import { applyToProgram, finishOnboarding } from "@/app/actions/affiliate"
import { AUDIENCE_SIZES, SOCIAL_KEYS, SOCIAL_LABELS, TRAFFIC_SOURCES } from "@/lib/affiliates/types"
import { selectClass } from "./ui"

const BLANK = { firstName: "", lastName: "", country: "", website: "", audienceSize: "", trafficSource: "", promotionMethod: "", reason: "" }

export function ApplyForm({ email, defaults, countries }: { email: string; defaults: Partial<typeof BLANK>; countries: { code: string; name: string }[] }) {
  const router = useRouter()
  const [form, setForm] = useState({ ...BLANK, ...defaults })
  const [socials, setSocials] = useState<Record<string, string>>({})
  const [terms, setTerms] = useState(false)
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const set = (k: keyof typeof BLANK) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) => setForm((f) => ({ ...f, [k]: e.target.value }))

  return (
    <form
      className="grid gap-5"
      noValidate={false}
      onSubmit={async (e) => {
        e.preventDefault()
        setPending(true)
        setError(null)
        try {
          const res = await applyToProgram({ ...form, socials, acceptTerms: terms })
          if (res.ok) {
            if (res.message) toast.success(res.message)
            router.refresh()
          } else setError(res.error)
        } catch {
          setError("That didn't go through. Check your connection and try again.")
        } finally {
          setPending(false)
        }
      }}
    >
      <div className="grid gap-4 sm:grid-cols-2">
        <label className="flex flex-col gap-1.5 text-xs text-muted-foreground">
          First name
          <Input value={form.firstName} onChange={set("firstName")} maxLength={60} required autoComplete="given-name" />
        </label>
        <label className="flex flex-col gap-1.5 text-xs text-muted-foreground">
          Last name
          <Input value={form.lastName} onChange={set("lastName")} maxLength={60} required autoComplete="family-name" />
        </label>
        <label className="flex flex-col gap-1.5 text-xs text-muted-foreground">
          Email
          <Input value={email} readOnly disabled />
        </label>
        <label className="flex flex-col gap-1.5 text-xs text-muted-foreground">
          Country
          <select value={form.country} onChange={set("country")} className={selectClass} required autoComplete="country">
            <option value="">Choose…</option>
            {countries.map((c) => (
              <option key={c.code} value={c.code}>
                {c.name}
              </option>
            ))}
          </select>
        </label>
      </div>

      <fieldset className="grid gap-4 sm:grid-cols-2">
        <legend className="mb-2 text-sm font-medium">Where you&apos;ll promote TradeLoop</legend>
        <label className="flex flex-col gap-1.5 text-xs text-muted-foreground sm:col-span-2">
          Website (optional if you add a social profile)
          <Input value={form.website} onChange={set("website")} maxLength={200} placeholder="https://" inputMode="url" autoComplete="url" />
        </label>
        {SOCIAL_KEYS.map((k) => (
          <label key={k} className="flex flex-col gap-1.5 text-xs text-muted-foreground">
            {SOCIAL_LABELS[k]}
            <Input value={socials[k] ?? ""} onChange={(e) => setSocials((s) => ({ ...s, [k]: e.target.value }))} maxLength={120} placeholder="@handle or link" />
          </label>
        ))}
        <label className="flex flex-col gap-1.5 text-xs text-muted-foreground">
          Main traffic source
          <select value={form.trafficSource} onChange={set("trafficSource")} className={selectClass} required>
            <option value="">Choose…</option>
            {TRAFFIC_SOURCES.map((s) => (
              <option key={s}>{s}</option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1.5 text-xs text-muted-foreground">
          Audience size
          <select value={form.audienceSize} onChange={set("audienceSize")} className={selectClass} required>
            <option value="">Choose…</option>
            {AUDIENCE_SIZES.map((s) => (
              <option key={s}>{s}</option>
            ))}
          </select>
        </label>
      </fieldset>

      <label className="flex flex-col gap-1.5 text-xs text-muted-foreground">
        How will you promote TradeLoop?
        <Textarea value={form.promotionMethod} onChange={set("promotionMethod")} rows={4} minLength={20} maxLength={1000} placeholder="e.g. A walkthrough video for my YouTube channel, plus a pinned link in my Discord." required />
      </label>
      <label className="flex flex-col gap-1.5 text-xs text-muted-foreground">
        Why do you want to partner with us? (optional)
        <Textarea value={form.reason} onChange={set("reason")} rows={3} maxLength={1000} />
      </label>

      <label className="flex items-start gap-2.5 text-sm">
        <input type="checkbox" checked={terms} onChange={(e) => setTerms(e.target.checked)} className="mt-0.5 size-4 shrink-0 accent-[var(--primary)]" required />
        <span>
          I agree to the{" "}
          <a href="#terms" className="font-medium text-primary hover:underline">
            affiliate program terms
          </a>{" "}
          below, including no self-referrals, no spam, and no bidding on TradeLoop brand keywords.
        </span>
      </label>

      {error && (
        <p role="alert" className="rounded-lg bg-[var(--loss)]/10 px-3 py-2 text-sm text-[var(--loss)]">
          {error}
        </p>
      )}
      <div>
        <Button type="submit" size="lg" disabled={pending || !terms}>
          {pending ? "Sending application…" : "Submit application"}
        </Button>
      </div>
    </form>
  )
}

// First run after approval: pick the public referral code and confirm the rules.
export function OnboardingForm({ suggested, siteHost }: { suggested: string; siteHost: string }) {
  const router = useRouter()
  const [code, setCode] = useState(suggested)
  const [terms, setTerms] = useState(false)
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const valid = /^[a-z0-9][a-z0-9_-]{2,23}$/.test(code)

  return (
    <form
      className="grid gap-5"
      onSubmit={async (e) => {
        e.preventDefault()
        setPending(true)
        setError(null)
        try {
          const res = await finishOnboarding({ code, acceptTerms: terms })
          if (res.ok) {
            router.push("/affiliate")
            router.refresh()
          } else setError(res.error)
        } catch {
          setError("That didn't go through. Check your connection and try again.")
        } finally {
          setPending(false)
        }
      }}
    >
      <label className="flex flex-col gap-1.5 text-xs text-muted-foreground">
        Your referral code
        <Input value={code} onChange={(e) => setCode(e.target.value.toLowerCase().replace(/[^a-z0-9_-]/g, ""))} maxLength={24} className="font-mono" aria-invalid={!valid} required autoFocus />
        <span>3–24 letters, numbers, dashes or underscores. Choose carefully — it&apos;s part of every link you share.</span>
      </label>
      <div className="rounded-lg border bg-muted/40 px-3 py-2.5">
        <p className="text-xs text-muted-foreground">Your link will be</p>
        <p className="mt-0.5 break-all font-mono text-sm">
          {siteHost}/?ref=<span className="font-semibold text-primary">{code || "…"}</span>
        </p>
      </div>
      <label className="flex items-start gap-2.5 text-sm">
        <input type="checkbox" checked={terms} onChange={(e) => setTerms(e.target.checked)} className="mt-0.5 size-4 shrink-0 accent-[var(--primary)]" required />
        <span>I understand how commissions, the holding period and payouts work, and I&apos;ll follow the program rules above.</span>
      </label>
      {error && (
        <p role="alert" className="rounded-lg bg-[var(--loss)]/10 px-3 py-2 text-sm text-[var(--loss)]">
          {error}
        </p>
      )}
      <div>
        <Button type="submit" size="lg" disabled={pending || !terms || !valid}>
          {pending ? "Setting up…" : "Open my dashboard"}
        </Button>
      </div>
    </form>
  )
}
