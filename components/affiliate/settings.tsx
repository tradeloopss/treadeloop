"use client"

import { useState } from "react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { saveNotificationPrefs, saveProfile } from "@/app/actions/affiliate"
import { NOTIFICATION_PREFS, SOCIAL_KEYS, SOCIAL_LABELS } from "@/lib/affiliates/types"
import { CopyField } from "./copy"
import { PayoutMethods, type MethodView } from "./payouts"
import { FieldRow, selectClass } from "./ui"
import { useAction } from "./use-action"

export type SettingsProfile = { firstName: string; lastName: string; email: string; country: string; website: string; socials: Record<string, string> }

function ProfileForm({ profile, countries }: { profile: SettingsProfile; countries: { code: string; name: string }[] }) {
  const [form, setForm] = useState(profile)
  const { pending, run } = useAction()
  const set = (k: "firstName" | "lastName" | "country" | "website") => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => setForm((f) => ({ ...f, [k]: e.target.value }))
  return (
    <form
      className="grid max-w-2xl gap-4"
      onSubmit={(e) => {
        e.preventDefault()
        run(() => saveProfile({ firstName: form.firstName, lastName: form.lastName, country: form.country, website: form.website, socials: form.socials }))
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
          <Input value={form.email} readOnly disabled />
          <span>Your TradeLoop account email. Program emails go here.</span>
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
      <label className="flex flex-col gap-1.5 text-xs text-muted-foreground">
        Website
        <Input value={form.website} onChange={set("website")} maxLength={200} placeholder="https://" inputMode="url" autoComplete="url" />
      </label>
      <fieldset className="grid gap-4 sm:grid-cols-2">
        <legend className="mb-2 text-xs font-medium text-foreground">Social profiles</legend>
        {SOCIAL_KEYS.map((k) => (
          <label key={k} className="flex flex-col gap-1.5 text-xs text-muted-foreground">
            {SOCIAL_LABELS[k]}
            <Input value={form.socials[k] ?? ""} onChange={(e) => setForm((f) => ({ ...f, socials: { ...f.socials, [k]: e.target.value } }))} maxLength={120} placeholder="@handle or link" />
          </label>
        ))}
      </fieldset>
      <div>
        <Button type="submit" disabled={pending}>
          {pending ? "Saving…" : "Save profile"}
        </Button>
      </div>
    </form>
  )
}

function NotificationsForm({ initial }: { initial: Record<string, boolean> }) {
  const [prefs, setPrefs] = useState(initial)
  const { pending, run } = useAction()
  return (
    <form
      className="max-w-2xl"
      onSubmit={(e) => {
        e.preventDefault()
        run(() => saveNotificationPrefs(prefs))
      }}
    >
      <p className="mb-3 text-sm text-muted-foreground">Choose which emails you get. Everything still appears under the bell in the portal, and messages about a failed payout or your account status are always sent.</p>
      <ul className="divide-y rounded-xl border">
        {NOTIFICATION_PREFS.map((p) => (
          <li key={p.key}>
            <label className="flex cursor-pointer items-center justify-between gap-4 px-4 py-3">
              <span>
                <span className="block text-sm font-medium">{p.label}</span>
                <span className="block text-xs text-muted-foreground">{p.description}</span>
              </span>
              <input type="checkbox" role="switch" checked={prefs[p.key] ?? p.default} onChange={(e) => setPrefs((s) => ({ ...s, [p.key]: e.target.checked }))} className="size-4 shrink-0 accent-[var(--primary)]" />
            </label>
          </li>
        ))}
      </ul>
      <Button type="submit" disabled={pending} className="mt-4">
        {pending ? "Saving…" : "Save preferences"}
      </Button>
    </form>
  )
}

export function AffiliateSettings({
  profile,
  countries,
  prefs,
  methods,
  account,
  security,
}: {
  profile: SettingsProfile
  countries: { code: string; name: string }[]
  prefs: Record<string, boolean>
  methods: MethodView[]
  // The Security tab is rendered by the page (it reuses the app's own
  // two-step verification panel).
  security: React.ReactNode
  account: { code: string; url: string; joined: string; rate: number; tier: string | null; cookieDays: number; holdDays: number; minPayout: string }
}) {
  return (
    <Tabs defaultValue="profile" className="gap-5">
      <TabsList className="max-w-full flex-wrap">
        <TabsTrigger value="profile">Profile</TabsTrigger>
        <TabsTrigger value="notifications">Notifications</TabsTrigger>
        <TabsTrigger value="payouts">Payout methods</TabsTrigger>
        <TabsTrigger value="account">Account</TabsTrigger>
        <TabsTrigger value="security">Security</TabsTrigger>
      </TabsList>

      <TabsContent value="profile">
        <ProfileForm profile={profile} countries={countries} />
      </TabsContent>

      <TabsContent value="notifications">
        <NotificationsForm initial={prefs} />
      </TabsContent>

      <TabsContent value="payouts" className="max-w-3xl">
        <PayoutMethods methods={methods} />
      </TabsContent>

      <TabsContent value="account" className="max-w-2xl">
        <div className="rounded-xl border bg-card px-5 py-3">
          <div className="py-2">
            <p className="mb-1.5 text-xs text-muted-foreground">Referral code</p>
            <CopyField value={account.code} label="Referral code" />
            <p className="mt-1.5 text-xs text-muted-foreground">Changing your code would break every link you&apos;ve already shared, so it&apos;s done by our team on request — contact affiliate support.</p>
          </div>
          <div className="divide-y border-t">
            <FieldRow label="Main link">
              <span className="break-all font-mono text-xs">{account.url}</span>
            </FieldRow>
            <FieldRow label="Commission rate">
              {account.rate}%{account.tier ? ` · ${account.tier} tier` : ""}
            </FieldRow>
            <FieldRow label="Tracking window">{account.cookieDays} days</FieldRow>
            <FieldRow label="Holding period">{account.holdDays} days</FieldRow>
            <FieldRow label="Minimum payout">{account.minPayout}</FieldRow>
            <FieldRow label="Affiliate since">{account.joined}</FieldRow>
          </div>
        </div>
      </TabsContent>

      <TabsContent value="security" className="max-w-2xl">
        {security}
      </TabsContent>
    </Tabs>
  )
}
