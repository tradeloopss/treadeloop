"use client"

import { useState } from "react"
import { useRouter } from "next/navigation"
import { ArrowRight } from "lucide-react"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Textarea } from "@/components/ui/textarea"
import { applyToProgram, finishOnboarding } from "@/app/actions/affiliate"
import { AUDIENCE_SIZES, SOCIAL_KEYS, SOCIAL_LABELS, TRAFFIC_SOURCES } from "@/lib/affiliates/types"
import { selectClass } from "./ui"
import { affiliateHref } from "@/lib/urls"

const field = "flex flex-col gap-1.5 text-xs font-medium text-foreground/80"
const Req = () => (
  <span className="text-[var(--loss)]" aria-hidden>
    *
  </span>
)

const BLANK = { firstName: "", lastName: "", country: "", website: "", audienceSize: "", trafficSource: "", promotionMethod: "", reason: "" }

// `termsHref`: the program terms page.
export function ApplyForm({ email, defaults, countries, termsHref }: { email: string; defaults: Partial<typeof BLANK>; countries: { code: string; name: string }[]; termsHref: string }) {
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
      aria-label="Affiliate application"
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
      <div className="grid gap-x-4 gap-y-3.5 sm:grid-cols-2">
        <label className={field}>
          <span>
            First name <Req />
          </span>
          <Input value={form.firstName} onChange={set("firstName")} maxLength={60} required autoComplete="given-name" placeholder="Your first name" />
        </label>
        <label className={field}>
          <span>
            Last name <Req />
          </span>
          <Input value={form.lastName} onChange={set("lastName")} maxLength={60} required autoComplete="family-name" placeholder="Your last name" />
        </label>
        <label className={field}>
          Email address
          <Input value={email} readOnly disabled />
        </label>
        <label className={field}>
          <span>
            Country <Req />
          </span>
          <select value={form.country} onChange={set("country")} className={selectClass} required autoComplete="country">
            <option value="">Select an option</option>
            {countries.map((c) => (
              <option key={c.code} value={c.code}>
                {c.name}
              </option>
            ))}
          </select>
        </label>
      </div>

      <fieldset className="grid gap-x-4 gap-y-3.5 sm:grid-cols-2">
        <legend className="mb-2.5 text-[13px] font-semibold text-foreground">
          Website / social media <Req />
          <span className="ms-1.5 font-normal text-muted-foreground">— at least one</span>
        </legend>
        <label className={`${field} sm:col-span-2`}>
          Website
          <Input value={form.website} onChange={set("website")} maxLength={200} placeholder="https:// (e.g. yourwebsite.com)" inputMode="url" autoComplete="url" />
        </label>
        <div className="grid grid-cols-2 gap-x-3 gap-y-3 sm:col-span-2 sm:grid-cols-3">
          {SOCIAL_KEYS.map((k) => (
            <label key={k} className={field}>
              {SOCIAL_LABELS[k]}
              <Input value={socials[k] ?? ""} onChange={(e) => setSocials((s) => ({ ...s, [k]: e.target.value }))} maxLength={120} placeholder="@handle" />
            </label>
          ))}
        </div>
        <label className={field}>
          <span>
            Where does your audience come from? <Req />
          </span>
          <select value={form.trafficSource} onChange={set("trafficSource")} className={selectClass} required>
            <option value="">Select an option</option>
            {TRAFFIC_SOURCES.map((s) => (
              <option key={s}>{s}</option>
            ))}
          </select>
        </label>
        <label className={field}>
          <span>
            How large is your audience? <Req />
          </span>
          <select value={form.audienceSize} onChange={set("audienceSize")} className={selectClass} required>
            <option value="">Select an option</option>
            {AUDIENCE_SIZES.map((s) => (
              <option key={s}>{s}</option>
            ))}
          </select>
        </label>
      </fieldset>

      <label className={field}>
        <span>
          How will you promote TradeLoop? <Req />
        </span>
        <Textarea value={form.promotionMethod} onChange={set("promotionMethod")} rows={3} minLength={20} maxLength={1000} placeholder="e.g. A walkthrough video for my YouTube channel, plus a pinned link in my Discord." required />
      </label>
      <label className={field}>
        Additional information (optional)
        <Textarea value={form.reason} onChange={set("reason")} rows={2} maxLength={1000} placeholder="Tell us more about your audience, your content, or why you'd like to partner with us." />
      </label>

      <label className="flex items-start gap-2.5 text-[13px] leading-relaxed">
        <input type="checkbox" checked={terms} onChange={(e) => setTerms(e.target.checked)} className="mt-0.5 size-4 shrink-0 accent-[var(--primary)]" required />
        <span>
          I agree to the{" "}
          {/* a new tab: what has been typed into the form stays where it is */}
          <a href={termsHref} target="_blank" rel="noopener" className="font-medium text-primary hover:underline">
            affiliate program terms
          </a>
          , including no self-referrals, no spam, and no bidding on TradeLoop brand keywords.
        </span>
      </label>

      {error && (
        <p role="alert" className="rounded-lg bg-[var(--loss)]/10 px-3 py-2 text-sm text-[var(--loss)]">
          {error}
        </p>
      )}
      <Button type="submit" size="lg" className="h-11 w-full text-sm" disabled={pending || !terms} aria-busy={pending}>
        {pending ? (
          "Sending application…"
        ) : (
          <>
            Submit Application <ArrowRight className="size-4 rtl:rotate-180" aria-hidden />
          </>
        )}
      </Button>
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
            router.push(affiliateHref("/affiliate"))
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
