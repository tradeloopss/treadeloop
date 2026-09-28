"use client"

import type React from "react"
import { useState } from "react"
import { useRouter } from "next/navigation"
import { toast } from "sonner"
import { User, Trophy, Flame, LineChart, LogIn, Award, Zap, Lock, Check } from "lucide-react"
import { authClient } from "@/lib/auth-client"
import { updateProfileSettings } from "@/app/actions/settings"
import type { SocialLinks } from "@/lib/settings/defaults"
import type { ProfileStats } from "@/lib/settings/profile-stats"
import { SettingsHeader, SectionLabel, Panel } from "@/components/settings/chrome"
import { FieldRow } from "@/components/settings/controls"
import { SaveButton } from "@/components/settings/pages/save-button"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Textarea } from "@/components/ui/textarea"
import { cn } from "@/lib/utils"
import { useT } from "@/components/locale-provider"
import { useIntlLocale } from "@/components/locale-provider"

type ProfileInfo = { bio: string | null; tradingStrategy: string | null; yearsTrading: number | null; social: SocialLinks }

export function ProfileView({
  user,
  handle,
  initial,
  stats,
}: {
  user: { name: string; email: string; image: string | null; createdAt: string }
  handle: string
  initial: ProfileInfo
  stats: ProfileStats
}) {
  const t = useT()
  const locale = useIntlLocale()
  const memberSince = new Date(user.createdAt).toLocaleDateString(locale, { month: "long", year: "numeric" })

  const [info, setInfo] = useState<ProfileInfo>(initial)
  const setSocial = (k: keyof SocialLinks, v: string) => setInfo((p) => ({ ...p, social: { ...p.social, [k]: v } }))

  const statTiles = [
    { icon: LineChart, label: t("Entries"), value: stats.entries },
    { icon: Flame, label: t("Streak"), value: `${stats.tradingStreak}d` },
    { icon: LineChart, label: t("Backtested"), value: stats.backtested },
    { icon: LogIn, label: t("Login Streak"), value: `${stats.loginStreak}d` },
    { icon: Award, label: t("Achievements"), value: stats.achievementsUnlocked },
    { icon: Zap, label: t("Experience"), value: stats.experience },
  ]

  return (
    <div className="space-y-6">
      <SettingsHeader icon={User} title={t("Profile")} />

      <ProfileCard user={user} handle={handle} memberSince={memberSince} />

      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 xl:grid-cols-6">
        {statTiles.map((s) => (
          <div key={s.label} className="rounded-lg border bg-card p-3">
            <div className="flex items-center gap-1.5 text-muted-foreground">
              <s.icon className="size-3.5" />
              <span className="text-[11px] tracking-wide uppercase">{s.label}</span>
            </div>
            <p className="mt-1.5 text-lg font-semibold tabular-nums">{s.value}</p>
          </div>
        ))}
      </div>

      <div className="grid gap-4 xl:grid-cols-2">
        <div className="space-y-3">
          <SectionLabel>{t("Profile Information")}</SectionLabel>
          <Panel title={t("About You")}>
            <FieldRow label={t("Trading strategy")}>
              <Input
                value={info.tradingStrategy ?? ""}
                onChange={(e) => setInfo((p) => ({ ...p, tradingStrategy: e.target.value }))}
                placeholder={t("e.g. ICT / SMC, breakout, mean reversion")}
                className="w-56"
              />
            </FieldRow>
            <FieldRow label={t("Years trading")}>
              <Input
                type="number"
                min={0}
                max={80}
                value={info.yearsTrading ?? ""}
                onChange={(e) => setInfo((p) => ({ ...p, yearsTrading: e.target.value === "" ? null : Number(e.target.value) }))}
                className="w-24 text-right"
              />
            </FieldRow>
            <div className="px-2 py-2.5">
              <label className="mb-1.5 block text-sm font-medium">{t("Bio")}</label>
              <Textarea
                value={info.bio ?? ""}
                onChange={(e) => setInfo((p) => ({ ...p, bio: e.target.value }))}
                rows={3}
                maxLength={600}
                placeholder={t("A short line about how you trade.")}
              />
            </div>
          </Panel>
        </div>

        <div className="space-y-3">
          <SectionLabel>{t("Social Links")}</SectionLabel>
          <Panel title={t("Links")}>
            <FieldRow label="X / Twitter">
              <Input value={info.social.x} onChange={(e) => setSocial("x", e.target.value)} placeholder="@handle" className="w-56" />
            </FieldRow>
            <FieldRow label="TradingView">
              <Input value={info.social.tradingview} onChange={(e) => setSocial("tradingview", e.target.value)} placeholder="username" className="w-56" />
            </FieldRow>
            <FieldRow label="Discord">
              <Input value={info.social.discord} onChange={(e) => setSocial("discord", e.target.value)} placeholder="username" className="w-56" />
            </FieldRow>
            <FieldRow label={t("Website")}>
              <Input value={info.social.website} onChange={(e) => setSocial("website", e.target.value)} placeholder="https://" className="w-56" />
            </FieldRow>
          </Panel>
        </div>
      </div>

      <SaveButton
        getValue={() => ({
          bio: info.bio,
          tradingStrategy: info.tradingStrategy,
          yearsTrading: info.yearsTrading,
          social: info.social,
        })}
        save={updateProfileSettings}
      />

      <div className="space-y-3">
        <SectionLabel>{t("Achievements")}</SectionLabel>
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 xl:grid-cols-4">
          {stats.achievements.map((a) => (
            <div
              key={a.id}
              className={cn(
                "flex items-start gap-2.5 rounded-lg border p-3",
                a.unlocked ? "bg-card" : "bg-card/40 opacity-70",
              )}
            >
              <span
                className={cn(
                  "mt-0.5 flex size-7 shrink-0 items-center justify-center rounded-md",
                  a.unlocked ? "bg-primary/15 text-primary" : "bg-muted text-muted-foreground",
                )}
              >
                {a.unlocked ? <Trophy className="size-3.5" /> : <Lock className="size-3.5" />}
              </span>
              <div className="min-w-0">
                <p className="flex items-center gap-1 text-xs font-semibold">
                  {a.name}
                  {a.unlocked && <Check className="size-3 text-[var(--gain)]" />}
                </p>
                <p className="mt-0.5 text-[11px] text-muted-foreground">{t(a.description)}</p>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}

function ProfileCard({
  user,
  handle,
  memberSince,
}: {
  user: { name: string; email: string; image: string | null }
  handle: string
  memberSince: string
}) {
  const t = useT()
  const router = useRouter()
  const [editing, setEditing] = useState(false)
  const [name, setName] = useState(user.name)
  const [image, setImage] = useState(user.image ?? "")
  const [busy, setBusy] = useState(false)

  async function save(e: React.FormEvent) {
    e.preventDefault()
    setBusy(true)
    const { error } = await authClient.updateUser({ name, image: image.trim() === "" ? null : image.trim() })
    setBusy(false)
    if (error) return toast.error(error.message ? t(error.message) : t("Could not update profile"))
    toast.success(t("Profile updated"))
    setEditing(false)
    router.refresh()
  }

  return (
    <div className="rounded-lg border bg-card p-4">
      <div className="flex items-center gap-4">
        <div className="flex size-14 shrink-0 items-center justify-center overflow-hidden rounded-full bg-primary/15 text-xl font-medium text-primary">
          {image ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={image} alt="" className="size-full object-cover" />
          ) : (
            name.charAt(0).toUpperCase()
          )}
        </div>
        <div className="min-w-0 flex-1">
          <p className="truncate text-base font-semibold">{name}</p>
          <p className="truncate text-sm text-muted-foreground">@{handle}</p>
          <p className="mt-0.5 text-xs text-muted-foreground">{t("Member since {date}", { date: memberSince })}</p>
        </div>
        <Button size="sm" variant="outline" onClick={() => setEditing((e) => !e)}>
          {editing ? t("Cancel") : t("Change avatar")}
        </Button>
      </div>

      {editing && (
        <form onSubmit={save} className="mt-4 grid gap-3 border-t pt-4 sm:grid-cols-2">
          <div className="space-y-1.5">
            <label htmlFor="pf-name" className="text-sm font-medium">
              {t("Display name")}
            </label>
            <Input id="pf-name" value={name} onChange={(e) => setName(e.target.value)} required />
          </div>
          <div className="space-y-1.5">
            <label htmlFor="pf-img" className="text-sm font-medium">
              {t("Avatar URL")}
            </label>
            <Input id="pf-img" value={image} onChange={(e) => setImage(e.target.value)} placeholder="https://…" />
          </div>
          <div className="sm:col-span-2">
            <Button type="submit" size="sm" disabled={busy}>
              {busy ? t("Saving…") : t("Save")}
            </Button>
          </div>
        </form>
      )}
    </div>
  )
}
