"use client"

import { useCallback, useEffect, useState } from "react"
import Link from "next/link"
import { useRouter } from "next/navigation"
import { toast } from "sonner"
import { Copy, EyeOff, Link2, Pause, Pencil, Play, Plus, ShieldCheck, UserMinus, Users } from "lucide-react"
import { cn } from "@/lib/utils"
import { leaveCopyShare, loadCopyFriends, pauseCopyShareFriend, removeCopyShareFriend, renameCopyShare, renewCopyShareLink, setCopyResultsShared, setCopyShareLimit, setCopyShareOpen, shareCopyAccount, stopCopySharing } from "@/app/actions/copy-trading"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { FRIEND_STATE, MAX_FRIENDS, type Activity, type FollowedStrategy, type FriendRow, type FriendsOverview, type Money, type SharedStrategy } from "@/lib/copy/friends"
import { ago, money } from "@/lib/copy/view"
import { useAction } from "@/components/insights/client"
import { Pill, Section, fieldClass, linkBtn, linkBtnPrimary } from "@/components/insights/ui"
import { useCopy } from "./store"
import { ConfirmDialog, PageHead, Stat, Toggle } from "./ui"

// Friends: the people who copy the strategies a trader shares, and the
// strategies that trader copies (lib/copy/friends.ts). One place to see who is
// copying and what came of it, and to run it: the link, who may join, a friend
// paused or removed.
//
// A friend's money is shown only when that friend shares it, and the page says
// which it is for each. A figure from simulated copies is marked SIM wherever
// it appears: it is not money anyone made.

const inviteUrl = (token: string) => `${typeof window === "undefined" ? "" : window.location.origin}/copy-trading/join/${token}`
const tone = (n: number | null | undefined) => cn(n != null && n > 0 && "text-[var(--gain)]", n != null && n < 0 && "text-[var(--loss)]")
const Sim = () => <span className="ms-1 rounded border px-1 text-[9px] font-semibold tracking-wide text-muted-foreground uppercase">Sim</span>

// "12 of 14 went through", said short
const through = (a: Activity) => (a.copies === 0 ? "—" : `${a.filled} / ${a.copies}`)
const rate = (m: Money) => (m.closed === 0 ? null : Math.round((m.wins / m.closed) * 100))

function Figure({ label, children, className }: { label: string; children: React.ReactNode; className?: string }) {
  return (
    <div className={cn("min-w-0", className)}>
      <p className="text-[10px] font-semibold tracking-wider text-muted-foreground uppercase">{label}</p>
      <p className="mt-0.5 truncate text-sm font-semibold tabular-nums">{children}</p>
    </div>
  )
}

export function Friends({ initial }: { initial: FriendsOverview }) {
  const { state, refresh } = useCopy()
  const router = useRouter()
  const [overview, setOverview] = useState(initial)
  const [share, setShare] = useState(false)
  useEffect(() => setOverview(initial), [initial])

  // the figures are read again every 15 seconds while the page is in front, and after anything is changed
  const reload = useCallback(async () => {
    const res = await loadCopyFriends().catch(() => null)
    if (res?.ok) setOverview(res.overview)
  }, [])
  useEffect(() => {
    const tick = () => document.visibilityState === "visible" && void reload()
    const timer = setInterval(tick, 15_000)
    return () => clearInterval(timer)
  }, [reload])
  const after = useCallback(async () => {
    await Promise.all([reload(), refresh()])
    router.refresh()
  }, [reload, refresh, router])

  const { sharing, following, totals } = overview
  // an account of the trader's own that could be shared, and is not yet
  const unshared = state.accounts.filter((a) => !state.shares.some((s) => s.accountId === a.id))
  const shareable = unshared.filter((a) => a.sharing.ok)
  // why none of the rest can be: said in the window instead of an empty list
  const blocked = shareable.length ? undefined : unshared.map((a) => a.sharing).find((s): s is { ok: false; reason: string } => !s.ok)?.reason
  return (
    <>
      <PageHead title="Friends" subtitle="Who copies the strategies you share, the strategies you copy, and what came of each.">
        <button type="button" className={`${linkBtnPrimary} max-md:h-11`} onClick={() => setShare(true)}>
          <Plus className="size-3.5" /> Share a strategy
        </button>
      </PageHead>

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat label="Friends" value={totals.friends} sub={sharing.length ? `of ${totals.seats} places` : "no strategy shared yet"} />
        <Stat label="Copying now" value={totals.copying} sub={totals.friends ? `of ${totals.friends}` : undefined} />
        <Stat label="Copies today" value={totals.copiesToday} sub="your trades, on your friends' accounts" />
        <Stat label="Friends' P&L today" value={totals.pnlFrom ? money(totals.pnlToday, true) : "—"} tone={totals.pnlFrom ? totals.pnlToday : null} sub={totals.friends === 0 ? undefined : totals.pnlFrom === 0 ? "nobody shares their results" : `from ${totals.pnlFrom} of ${totals.friends} who share theirs`} />
      </div>

      <Section title="Strategies you share" description="Each is one of your own broker accounts. Friends copy its trades onto accounts of their own: they never see its balance, and can never trade on it.">
        {sharing.length === 0 ? (
          <div className="rounded-lg border border-dashed p-5 text-center">
            <Users className="mx-auto size-6 text-muted-foreground" aria-hidden />
            <p className="mt-2 text-sm font-medium">You don&apos;t share a strategy yet</p>
            <p className="mx-auto mt-1 max-w-md text-sm text-muted-foreground">Share one of your broker accounts, send the link to people you know, and see here who copies it and how it goes for them.</p>
            <button type="button" className={cn(linkBtnPrimary, "mt-3")} onClick={() => setShare(true)}>
              Share a strategy
            </button>
          </div>
        ) : (
          <div className="space-y-4">
            {sharing.map((s) => (
              <Shared key={s.shareId} strategy={s} after={after} />
            ))}
          </div>
        )}
      </Section>

      <Section title="Strategies you follow" description="Shared with you by friends. What your own copies of each came to.">
        {following.length === 0 ? (
          <p className="text-sm text-muted-foreground">None. To copy a friend&apos;s strategy, open the invitation link they send you.</p>
        ) : (
          <div className="grid gap-3 lg:grid-cols-2">
            {following.map((f) => (
              <Followed key={f.shareId} strategy={f} after={after} />
            ))}
          </div>
        )}
      </Section>

      <ShareDialog open={share} onClose={() => setShare(false)} accounts={shareable.map((a) => ({ id: a.id, name: a.name }))} blocked={blocked} after={after} />
    </>
  )
}

// ------------------------------------------------------------------ one shared strategy, and its friends

type Ask = { kind: "link" } | { kind: "stop" } | { kind: "remove"; friend: FriendRow } | { kind: "pause"; friend: FriendRow } | null

function Shared({ strategy: s, after }: { strategy: SharedStrategy; after: () => Promise<void> }) {
  const { account } = useCopy()
  const { pending, run } = useAction()
  const [ask, setAsk] = useState<Ask>(null)
  const [edit, setEdit] = useState(false)
  const [name, setName] = useState(s.name)
  const mine = account(s.accountId)
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(inviteUrl(s.token))
      toast.success("Invitation link copied.")
    } catch {
      toast.error("Couldn't copy. Select the link and copy it by hand.")
    }
  }
  const done = (message: string) => async () => {
    toast.success(message)
    setAsk(null)
    await after()
  }
  return (
    <div className="rounded-xl border">
      <div className="flex flex-wrap items-start gap-x-4 gap-y-3 border-b p-3 sm:p-4">
        {/* a row of its own on a phone: the figures go under the name, not beside it */}
        <div className="min-w-0 flex-1 basis-full sm:basis-0">
          {edit ? (
            <form
              className="flex max-w-sm gap-1.5"
              onSubmit={(e) => {
                e.preventDefault()
                run(() => renameCopyShare(s.shareId, name), async () => (setEdit(false), await done("Renamed.")()))
              }}
            >
              <input autoFocus className={fieldClass} maxLength={60} value={name} aria-label="Strategy name" onChange={(e) => setName(e.target.value)} />
              <button type="submit" disabled={pending || name.trim().length < 2} className={cn(linkBtnPrimary, "h-9")}>
                Save
              </button>
              <button type="button" className={cn(linkBtn, "h-9")} onClick={() => (setEdit(false), setName(s.name))}>
                Cancel
              </button>
            </form>
          ) : (
            <p className="flex flex-wrap items-center gap-2">
              <span className="text-base font-semibold tracking-tight">{s.name}</span>
              <Pill tone={s.status === "active" ? "good" : "warn"}>{s.status === "active" ? "Open to new friends" : "Closed to new friends"}</Pill>
              <button type="button" aria-label={`Rename ${s.name}`} className={cn(linkBtn, "h-7 w-7 px-0")} onClick={() => setEdit(true)}>
                <Pencil className="size-3.5" aria-hidden />
              </button>
            </p>
          )}
          <p className="mt-0.5 text-xs text-muted-foreground">
            Your account {s.accountName} · shared {ago(s.createdAt)}
          </p>
        </div>
        <div className="flex gap-5">
          <Figure label="Friends">
            {s.friends.length} / {s.maxFriends}
          </Figure>
          <Figure label="Your day P&L">
            <span className={tone(mine?.dayPnl)}>{mine ? money(mine.dayPnl, true) : "—"}</span>
          </Figure>
          <Figure label="Your open P&L">
            <span className={tone(mine?.openPnl)}>{mine?.openPnl != null ? money(mine.openPnl, true) : "—"}</span>
          </Figure>
        </div>
      </div>

      <div className="space-y-3 p-3 sm:p-4">
        <div className="grid gap-3 lg:grid-cols-[1fr_auto] lg:items-end">
          <div className="min-w-0">
            <p className="text-[11px] font-semibold tracking-wide text-muted-foreground uppercase">Invitation link</p>
            <div className="mt-1 flex gap-1.5">
              <input readOnly aria-label="Invitation link" className={cn(fieldClass, "min-w-0 flex-1 font-mono text-xs")} value={inviteUrl(s.token)} onFocus={(e) => e.currentTarget.select()} />
              <button type="button" className={cn(linkBtn, "h-9 shrink-0")} onClick={copy}>
                <Copy className="size-3.5" aria-hidden /> Copy
              </button>
              <button type="button" disabled={pending} className={cn(linkBtn, "h-9 shrink-0")} onClick={() => setAsk({ kind: "link" })}>
                <Link2 className="size-3.5" aria-hidden /> New link
              </button>
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-x-4 gap-y-2 text-sm">
            <label className="flex items-center gap-2">
              Places
              <select className={cn(fieldClass, "h-9 w-16")} disabled={pending} value={s.maxFriends} aria-label="How many friends may follow" onChange={(e) => run(() => setCopyShareLimit(s.shareId, Number(e.target.value)), done("Saved."))}>
                {Array.from({ length: MAX_FRIENDS }, (_, i) => i + 1).map((n) => (
                  <option key={n} value={n}>
                    {n}
                  </option>
                ))}
              </select>
            </label>
            <span className="flex items-center gap-2">
              Open to new friends
              <Toggle checked={s.status === "active"} disabled={pending} label="Open to new friends" onChange={(open) => run(() => setCopyShareOpen(s.shareId, open), done(open ? "The link works again." : "Nobody new can join. Friends who follow already keep copying."))} />
            </span>
            <button type="button" disabled={pending} className={cn(linkBtn, "text-[var(--loss)]")} onClick={() => setAsk({ kind: "stop" })}>
              Stop sharing
            </button>
          </div>
        </div>

        {s.friends.length === 0 ? (
          <p className="rounded-lg border border-dashed p-3 text-sm text-muted-foreground">Nobody has accepted yet. Send the link to people you know: anyone with it can follow the strategy.</p>
        ) : (
          <>
            {/* a table where there is room for one */}
            <div className="hidden overflow-x-auto md:block">
              <table className="w-full min-w-[760px] text-sm">
                <thead>
                  <tr className="border-b text-start text-[11px] font-semibold tracking-wide text-muted-foreground uppercase">
                    <th className="py-2 pe-3 text-start font-semibold">Friend</th>
                    <th className="px-3 py-2 text-start font-semibold">Status</th>
                    <th className="px-3 py-2 text-end font-semibold">Copies today</th>
                    <th className="px-3 py-2 text-end font-semibold">Went through</th>
                    <th className="px-3 py-2 text-end font-semibold">P&amp;L today</th>
                    <th className="px-3 py-2 text-end font-semibold">P&amp;L all time</th>
                    <th className="px-3 py-2 text-end font-semibold">Open</th>
                    <th className="px-3 py-2 text-start font-semibold">Last copy</th>
                    <th className="py-2 ps-3 text-end font-semibold">
                      <span className="sr-only">Actions</span>
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y">
                  {s.friends.map((f) => (
                    <tr key={f.userId} className="tabular-nums">
                      <td className="py-2.5 pe-3">
                        <p className="font-medium">{f.name}</p>
                        <p className="text-xs text-muted-foreground">
                          joined {ago(f.joinedAt)}
                          {f.followers > 0 && ` · ${f.followers} ${f.followers === 1 ? "account" : "accounts"}`}
                        </p>
                      </td>
                      <td className="px-3 py-2.5">
                        <Pill tone={FRIEND_STATE[f.state].tone}>{f.state === "paused_by_owner" ? "Paused by you" : FRIEND_STATE[f.state].label}</Pill>
                      </td>
                      <td className="px-3 py-2.5 text-end">
                        {f.activity.today}
                        {f.activity.simulated && f.activity.copies > 0 && <Sim />}
                      </td>
                      <td className="px-3 py-2.5 text-end">
                        {through(f.activity)}
                        {f.activity.failed > 0 && <span className="ms-1 text-xs text-[var(--loss)]">{f.activity.failed} failed</span>}
                      </td>
                      {f.money ? (
                        <>
                          <td className={cn("px-3 py-2.5 text-end font-medium", tone(f.money.pnlToday))}>
                            {money(f.money.pnlToday, true)}
                            {f.money.simulated && <Sim />}
                          </td>
                          <td className={cn("px-3 py-2.5 text-end font-medium", tone(f.money.closedPnl))}>
                            {money(f.money.closedPnl, true)}
                            {rate(f.money) != null && <span className="ms-1 text-xs font-normal text-muted-foreground">{rate(f.money)}% won</span>}
                          </td>
                          <td className="px-3 py-2.5 text-end">
                            {f.money.open === 0 ? "—" : f.money.open}
                            {f.money.openPnl != null && <span className={cn("ms-1 text-xs", tone(f.money.openPnl))}>{money(f.money.openPnl, true)}</span>}
                          </td>
                        </>
                      ) : (
                        <td colSpan={3} className="px-3 py-2.5 text-end text-xs text-muted-foreground">
                          <EyeOff className="me-1 inline size-3.5" aria-hidden />
                          {f.name} doesn&apos;t share their results
                        </td>
                      )}
                      <td className="px-3 py-2.5 text-xs text-muted-foreground">{ago(f.activity.lastCopyAt)}</td>
                      <td className="py-2.5 ps-3">
                        <FriendActions friend={f} pending={pending} onPause={() => (f.state === "paused_by_owner" ? run(() => pauseCopyShareFriend(s.shareId, f.userId, false), done(`${f.name} can copy it again. They switch their group back on themselves.`)) : setAsk({ kind: "pause", friend: f }))} onRemove={() => setAsk({ kind: "remove", friend: f })} />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {/* and one friend at a time on a phone */}
            <ul className="space-y-2 md:hidden">
              {s.friends.map((f) => (
                <li key={f.userId} className="rounded-lg border p-3">
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <p className="truncate text-sm font-medium">{f.name}</p>
                      <p className="text-xs text-muted-foreground">joined {ago(f.joinedAt)}</p>
                    </div>
                    <Pill tone={FRIEND_STATE[f.state].tone}>{f.state === "paused_by_owner" ? "Paused by you" : FRIEND_STATE[f.state].label}</Pill>
                  </div>
                  <div className="mt-2.5 grid grid-cols-3 gap-2">
                    <Figure label="Today">
                      {f.activity.today}
                      {f.activity.simulated && f.activity.copies > 0 && <Sim />}
                    </Figure>
                    <Figure label="Went through">{through(f.activity)}</Figure>
                    <Figure label="Last copy">{ago(f.activity.lastCopyAt)}</Figure>
                    {f.money ? (
                      <>
                        <Figure label="P&L today">
                          <span className={tone(f.money.pnlToday)}>{money(f.money.pnlToday, true)}</span>
                          {f.money.simulated && <Sim />}
                        </Figure>
                        <Figure label="P&L all time">
                          <span className={tone(f.money.closedPnl)}>{money(f.money.closedPnl, true)}</span>
                        </Figure>
                        <Figure label="Open">{f.money.open === 0 ? "—" : `${f.money.open}${f.money.openPnl != null ? ` · ${money(f.money.openPnl, true)}` : ""}`}</Figure>
                      </>
                    ) : (
                      <p className="col-span-3 text-xs text-muted-foreground">
                        <EyeOff className="me-1 inline size-3.5" aria-hidden />
                        {f.name} doesn&apos;t share their results
                      </p>
                    )}
                  </div>
                  <div className="mt-2.5 flex justify-end">
                    <FriendActions friend={f} pending={pending} onPause={() => (f.state === "paused_by_owner" ? run(() => pauseCopyShareFriend(s.shareId, f.userId, false), done(`${f.name} can copy it again. They switch their group back on themselves.`)) : setAsk({ kind: "pause", friend: f }))} onRemove={() => setAsk({ kind: "remove", friend: f })} />
                  </div>
                </li>
              ))}
            </ul>
          </>
        )}
        <p className="flex items-start gap-1.5 text-xs text-muted-foreground">
          <ShieldCheck className="mt-0.5 size-3.5 shrink-0 text-primary" aria-hidden /> You see whether a friend is copying and how many copies went through. Their profit and loss is shown only when they choose to share it, and never their balance or their account.
        </p>
      </div>

      <ConfirmDialog open={ask?.kind === "link"} onClose={() => setAsk(null)} title="Make a new invitation link?" action="New link" pending={pending} onConfirm={() => run(() => renewCopyShareLink(s.shareId), done("New link made. The old one no longer works."))}>
        <p>The link you sent before stops working. Friends who already follow are not affected.</p>
      </ConfirmDialog>
      <ConfirmDialog open={ask?.kind === "stop"} onClose={() => setAsk(null)} title={`Stop sharing “${s.name}”?`} action="Stop sharing" danger pending={pending} onConfirm={() => run(() => stopCopySharing(s.shareId), done("No longer shared."))}>
        <p>{s.friends.length === 0 ? "The invitation link stops working." : `Copying stops for ${s.friends.length === 1 ? "your friend" : `all ${s.friends.length} friends`}, at once.`}</p>
        <p>Positions your friends already hold are left as they are: only they can close their own positions.</p>
      </ConfirmDialog>
      <ConfirmDialog open={ask?.kind === "pause"} onClose={() => setAsk(null)} title={ask?.kind === "pause" ? `Pause ${ask.friend.name}?` : ""} action="Pause" pending={pending} onConfirm={() => ask?.kind === "pause" && run(() => pauseCopyShareFriend(s.shareId, ask.friend.userId, true), done(`${ask.friend.name} is paused. Their copying has stopped.`))}>
        <p>Their copying of this strategy stops at once. They keep their place, and you can let them carry on whenever you like.</p>
        <p>Positions they already hold are left as they are, and are no longer closed when you close yours: only they can close their own positions.</p>
      </ConfirmDialog>
      <ConfirmDialog open={ask?.kind === "remove"} onClose={() => setAsk(null)} title={ask?.kind === "remove" ? `Remove ${ask.friend.name}?` : ""} action="Remove" danger pending={pending} onConfirm={() => ask?.kind === "remove" && run(() => removeCopyShareFriend(s.shareId, ask.friend.userId), done("Removed. Their copying has stopped."))}>
        <p>Their copying of this strategy stops at once, and they can&apos;t start it again without a new invitation.</p>
        <p>Positions they already hold are left as they are.</p>
      </ConfirmDialog>
    </div>
  )
}

function FriendActions({ friend, pending, onPause, onRemove }: { friend: FriendRow; pending: boolean; onPause: () => void; onRemove: () => void }) {
  const paused = friend.state === "paused_by_owner"
  return (
    <span className="flex justify-end gap-1.5">
      <button type="button" disabled={pending} className={cn(linkBtn, "h-8 px-2.5 text-xs")} onClick={onPause}>
        {paused ? <Play className="size-3.5" aria-hidden /> : <Pause className="size-3.5" aria-hidden />}
        {paused ? "Resume" : "Pause"}
      </button>
      <button type="button" disabled={pending} aria-label={`Remove ${friend.name}`} className={cn(linkBtn, "h-8 w-8 px-0 text-[var(--loss)]")} onClick={onRemove}>
        <UserMinus className="size-3.5" aria-hidden />
      </button>
    </span>
  )
}

// ------------------------------------------------------------------ one strategy the trader follows

function Followed({ strategy: f, after }: { strategy: FollowedStrategy; after: () => Promise<void> }) {
  const { pending, run } = useAction()
  const [leave, setLeave] = useState(false)
  const won = rate(f.money)
  return (
    <div className="rounded-xl border p-3 sm:p-4">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="truncate text-base font-semibold tracking-tight">{f.name}</p>
          <p className="text-xs text-muted-foreground">
            Shared by {f.owner} · you joined {ago(f.joinedAt)}
          </p>
        </div>
        <Pill tone={FRIEND_STATE[f.state].tone}>{f.state === "paused_by_owner" ? `Paused by ${f.owner}` : FRIEND_STATE[f.state].label}</Pill>
      </div>
      {f.state === "paused_by_owner" && <p className="mt-2 rounded-lg border border-[var(--warning)]/50 bg-[var(--warning)]/10 p-2.5 text-xs">{f.owner} has paused your copying of this strategy. Positions you already hold are left as they are: close them yourself if you want to. It can be switched back on when they resume it.</p>}

      <div className="mt-3 grid grid-cols-3 gap-3">
        <Figure label="P&L today">
          <span className={tone(f.money.pnlToday)}>{money(f.money.pnlToday, true)}</span>
          {f.money.simulated && <Sim />}
        </Figure>
        <Figure label="P&L all time">
          <span className={tone(f.money.closedPnl)}>{money(f.money.closedPnl, true)}</span>
        </Figure>
        <Figure label="Open now">{f.money.open === 0 ? "—" : `${f.money.open}${f.money.openPnl != null ? ` · ${money(f.money.openPnl, true)}` : ""}`}</Figure>
        <Figure label="Copies today">{f.activity.today}</Figure>
        <Figure label="Went through">{through(f.activity)}</Figure>
        <Figure label="Closed trades">{f.money.closed === 0 ? "—" : `${f.money.closed}${won != null ? ` · ${won}% won` : ""}`}</Figure>
      </div>
      {f.money.unsynced > 0 && <p className="mt-2 text-xs text-muted-foreground">{f.money.unsynced === 1 ? "1 closed copy isn't" : `${f.money.unsynced} closed copies aren't`} in your journal yet: counted here once the account has synced.</p>}
      {f.money.simulated && <p className="mt-2 text-xs text-muted-foreground">Simulated copies: nothing was opened on your accounts, and this is not money made or lost.</p>}

      <div className="mt-3">
        <p className="text-[11px] font-semibold tracking-wide text-muted-foreground uppercase">Your groups on it</p>
        {f.groups.length === 0 ? (
          <p className="mt-1 text-sm text-muted-foreground">
            None yet.{" "}
            <Link href="/copy-trading" className="font-medium text-primary hover:underline">
              Create a Copy Group
            </Link>{" "}
            and choose this strategy as its Leader.
          </p>
        ) : (
          <ul className="mt-1 divide-y text-sm">
            {f.groups.map((g) => (
              <li key={g.id} className="flex items-center justify-between gap-2 py-1.5">
                <Link href={`/copy-trading/cockpit?group=${g.id}`} className="min-w-0 truncate font-medium hover:underline">
                  {g.name}
                </Link>
                <span className="text-xs text-muted-foreground">{g.status === "active" ? "Copying" : g.status === "draft" ? "Not switched on yet" : "Paused"}</span>
              </li>
            ))}
          </ul>
        )}
      </div>

      <div className="mt-3 flex flex-wrap items-center justify-between gap-3 border-t pt-3">
        <label className="flex min-w-0 flex-1 items-start gap-2.5 text-sm">
          <Toggle checked={f.sharesResults} disabled={pending} label={`Let ${f.owner} see my results`} onChange={(on) => run(() => setCopyResultsShared(f.shareId, on), async () => (toast.success(on ? `${f.owner} can now see what your copies of this strategy come to.` : `${f.owner} no longer sees your results.`), await after()))} />
          <span className="min-w-0">
            <span className="block font-medium">Let {f.owner} see my results</span>
            <span className="block text-xs text-muted-foreground">The profit and loss of your copies of this strategy, and how many are open. Never your balance, your account or your other trades.</span>
          </span>
        </label>
        <button type="button" disabled={pending} className={cn(linkBtn, "text-[var(--loss)]")} onClick={() => setLeave(true)}>
          Stop following
        </button>
      </div>
      <ConfirmDialog open={leave} onClose={() => setLeave(false)} title={`Stop following “${f.name}”?`} action="Stop following" danger pending={pending} onConfirm={() => run(() => leaveCopyShare(f.shareId), async () => (toast.success("You no longer follow it."), setLeave(false), await after()))}>
        <p>Your groups that copy it stop copying. Positions you already hold are left as they are: close them yourself in the Cockpit if you want to.</p>
        <p>To follow it again you need a new invitation.</p>
      </ConfirmDialog>
    </div>
  )
}

// ------------------------------------------------------------------ share one more of the trader's accounts

function ShareDialog({ open, onClose, accounts, blocked, after }: { open: boolean; onClose: () => void; accounts: { id: number; name: string }[]; blocked?: string; after: () => Promise<void> }) {
  const { pending, run } = useAction()
  const [accountId, setAccountId] = useState<number | null>(null)
  const [name, setName] = useState("")
  const [attested, setAttested] = useState(false)
  const chosen = accounts.find((a) => a.id === accountId) ?? accounts[0]
  const close = () => {
    setAccountId(null)
    setName("")
    setAttested(false)
    onClose()
  }
  return (
    <Dialog open={open} onOpenChange={(next) => !next && close()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Share a strategy</DialogTitle>
          <DialogDescription render={<div />} className="space-y-2 text-sm text-muted-foreground">
            <p>Friends you invite copy one of your accounts&apos; trades onto their own broker accounts, at sizes and limits they choose. They see the trades and nothing else: no balance, no login. They can never trade on it.</p>
          </DialogDescription>
        </DialogHeader>
        {accounts.length === 0 ? (
          <p className="rounded-lg border border-dashed p-3 text-sm text-muted-foreground">{blocked ?? "There is no account left to share: connect a broker account on the Connection page first. A prop-firm account can't be shared."}</p>
        ) : (
          <div className="space-y-3">
            <label className="flex flex-col gap-1.5 text-sm font-medium">
              Account
              <select className={fieldClass} value={chosen?.id ?? ""} onChange={(e) => setAccountId(Number(e.target.value))}>
                {accounts.map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.name}
                  </option>
                ))}
              </select>
            </label>
            <label className="flex flex-col gap-1.5 text-sm font-medium">
              Strategy name
              <input className={fieldClass} maxLength={60} value={name} placeholder={chosen?.name ?? "Gold strategy"} onChange={(e) => setName(e.target.value)} />
              <span className="text-xs font-normal text-muted-foreground">What your friends see it called.</span>
            </label>
            <label className="flex cursor-pointer items-start gap-2 text-sm">
              <input type="checkbox" className="mt-0.5 size-4 shrink-0 accent-[var(--primary)]" checked={attested} onChange={(e) => setAttested(e.target.checked)} />
              <span>This is my own account with a broker. It is not a prop-firm account (evaluation, challenge or funded).</span>
            </label>
          </div>
        )}
        <DialogFooter>
          <button type="button" className={linkBtn} onClick={close}>
            Cancel
          </button>
          {chosen && (
            <button
              type="button"
              disabled={pending || !attested || (name.trim() || chosen.name).trim().length < 2}
              className="inline-flex h-8 items-center justify-center rounded-md bg-primary px-3 text-sm font-semibold text-white transition-colors hover:bg-primary/90 disabled:pointer-events-none disabled:opacity-50"
              onClick={() => run(() => shareCopyAccount(chosen.id, name.trim() || chosen.name, attested), async () => (toast.success("Strategy shared. Send the link to your friends."), close(), await after()))}
            >
              {pending ? "Sharing…" : "Share this strategy"}
            </button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
