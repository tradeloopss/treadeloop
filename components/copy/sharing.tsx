"use client"

import { useState } from "react"
import Link from "next/link"
import { useRouter } from "next/navigation"
import { toast } from "sonner"
import { Copy, Link2, ShieldCheck, UserMinus, Users } from "lucide-react"
import { cn } from "@/lib/utils"
import { leaveCopyShare, removeCopyShareFriend, renewCopyShareLink, setCopyShareOpen, shareCopyAccount, stopCopySharing } from "@/app/actions/copy-trading"
import { acceptCopyInvite } from "@/app/actions/copy-invite"
import { formatQuantity } from "@/lib/copy/contracts"
import type { InviteView } from "@/lib/copy/shares"
import { ago, type AccountView } from "@/lib/copy/view"
import { Sheet, useAction } from "@/components/insights/client"
import { Pill, Section, fieldClass, linkBtn, linkBtnPrimary } from "@/components/insights/ui"
import { useCopy } from "./store"
import { ConfirmDialog, HealthPill, Toggle } from "./ui"

// Sharing a strategy with friends (lib/copy/shares.ts). The owner's panel on an
// account, what a friend sees of a strategy shared with them, and the
// invitation itself. Broker accounts only, on both sides: every screen says so
// before it is asked, and the server holds to it whatever a screen showed.

const inviteUrl = (token: string) => `${typeof window === "undefined" ? "" : window.location.origin}/copy-trading/join/${token}`
const RULES = "Broker accounts only: a prop-firm account can't be shared and can't follow a friend's strategy."

// On one of the trader's own accounts: start sharing it, or run the share it has.
export function SharePanel({ account }: { account: AccountView }) {
  const { state, refresh } = useCopy()
  const router = useRouter()
  const { pending, run } = useAction()
  const share = state.shares.find((s) => s.accountId === account.id)
  const [name, setName] = useState(account.name)
  const [attested, setAttested] = useState(false)
  const [confirm, setConfirm] = useState<"stop" | "link" | { remove: string; name: string } | null>(null)
  const after = async () => {
    await refresh()
    router.refresh()
  }
  const copy = async (text: string) => {
    try {
      await navigator.clipboard.writeText(text)
      toast.success("Invitation link copied.")
    } catch {
      toast.error("Couldn't copy. Select the link and copy it by hand.")
    }
  }

  return (
    <div className="rounded-xl border p-3">
      <p className="flex items-center gap-2 text-sm font-semibold">
        <Users className="size-4 text-primary" aria-hidden /> Share with friends
        {share && <Pill tone={share.status === "active" ? "good" : "warn"}>{share.status === "active" ? "Shared" : "Closed to new friends"}</Pill>}
      </p>
      {!account.sharing.ok ? (
        <p className="mt-1.5 text-xs text-muted-foreground">{account.sharing.reason}</p>
      ) : !share ? (
        <div className="mt-2 space-y-2.5">
          <p className="text-xs text-muted-foreground">Friends you invite can copy this account&apos;s trades onto their own broker accounts, at sizes and limits they choose. They see the trades and nothing else: no balance, no login. They can never trade on it.</p>
          <label className="flex flex-col gap-1 text-xs font-medium">
            Strategy name
            <input className={fieldClass} maxLength={60} value={name} onChange={(e) => setName(e.target.value)} placeholder="Gold strategy" />
          </label>
          <label className="flex cursor-pointer items-start gap-2 text-xs">
            <input type="checkbox" className="mt-0.5 size-4 shrink-0 accent-[var(--primary)]" checked={attested} onChange={(e) => setAttested(e.target.checked)} />
            <span>This is my own account with a broker. It is not a prop-firm account (evaluation, challenge or funded).</span>
          </label>
          <button type="button" disabled={pending || !attested || name.trim().length < 2} className={linkBtnPrimary} onClick={() => run(() => shareCopyAccount(account.id, name, attested), async () => (toast.success("Strategy shared. Send the link to your friends."), await after()))}>
            {pending ? "Sharing…" : "Share this strategy"}
          </button>
        </div>
      ) : (
        <div className="mt-2 space-y-3">
          <p className="text-sm font-medium">{share.name}</p>
          <div>
            <p className="text-[11px] font-semibold tracking-wide text-muted-foreground uppercase">Invitation link</p>
            <div className="mt-1 flex gap-1.5">
              <input readOnly aria-label="Invitation link" className={cn(fieldClass, "min-w-0 flex-1 font-mono text-xs")} value={inviteUrl(share.token)} onFocus={(e) => e.currentTarget.select()} />
              <button type="button" className={cn(linkBtn, "h-9 shrink-0")} onClick={() => copy(inviteUrl(share.token))}>
                <Copy className="size-3.5" aria-hidden /> Copy
              </button>
            </div>
            <p className="mt-1 text-xs text-muted-foreground">
              Anyone with this link can follow the strategy, and gets Copy Trading for it. Send it only to people you know.{" "}
              <Link href="/copy-trading/friends" className="font-medium text-primary hover:underline">
                Manage friends and see their results
              </Link>
            </p>
          </div>
          <div>
            <p className="text-[11px] font-semibold tracking-wide text-muted-foreground uppercase">
              Friends ({share.members.length} of {share.maxFriends})
            </p>
            {share.members.length === 0 ? (
              <p className="mt-1 text-xs text-muted-foreground">Nobody has accepted yet.</p>
            ) : (
              <ul className="mt-1 divide-y text-sm">
                {share.members.map((m) => (
                  <li key={m.userId} className="flex items-center gap-2 py-1.5">
                    <span className="min-w-0 flex-1 truncate">
                      <span className="font-medium">{m.name}</span>
                      <span className="text-xs text-muted-foreground"> · joined {ago(m.joinedAt)}</span>
                    </span>
                    <Pill tone={m.paused ? "warn" : m.copying ? "good" : "none"}>{m.paused ? "Paused by you" : m.copying ? "Copying" : "Not copying"}</Pill>
                    <button type="button" aria-label={`Remove ${m.name}`} className={cn(linkBtn, "h-7 w-7 px-0")} onClick={() => setConfirm({ remove: m.userId, name: m.name })}>
                      <UserMinus className="size-3.5" aria-hidden />
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
          <div className="flex items-center justify-between gap-2 text-sm">
            <span>Open to new friends</span>
            <Toggle checked={share.status === "active"} disabled={pending} label="Open to new friends" onChange={(open) => run(() => setCopyShareOpen(share.id, open), async () => (toast.success(open ? "The link works again." : "Nobody new can join. Friends who follow already keep copying."), await after()))} />
          </div>
          <div className="flex flex-wrap gap-2">
            <button type="button" disabled={pending} className={linkBtn} onClick={() => setConfirm("link")}>
              <Link2 className="size-3.5" aria-hidden /> New link
            </button>
            <button type="button" disabled={pending} className={cn(linkBtn, "text-[var(--loss)]")} onClick={() => setConfirm("stop")}>
              Stop sharing
            </button>
          </div>
          <p className="flex items-start gap-1.5 text-xs text-muted-foreground">
            <ShieldCheck className="mt-0.5 size-3.5 shrink-0 text-primary" aria-hidden /> {RULES}
          </p>
        </div>
      )}
      {share && (
        <>
          <ConfirmDialog open={confirm === "link"} onClose={() => setConfirm(null)} title="Make a new invitation link?" action="New link" pending={pending} onConfirm={() => run(() => renewCopyShareLink(share.id), async () => (toast.success("New link made. The old one no longer works."), setConfirm(null), await after()))}>
            <p>The link you sent before stops working. Friends who already follow are not affected.</p>
          </ConfirmDialog>
          <ConfirmDialog open={confirm === "stop"} onClose={() => setConfirm(null)} title={`Stop sharing “${share.name}”?`} action="Stop sharing" danger pending={pending} onConfirm={() => run(() => stopCopySharing(share.id), async () => (toast.success("No longer shared."), setConfirm(null), await after()))}>
            <p>{share.members.length === 0 ? "The invitation link stops working." : `Copying stops for ${share.members.length === 1 ? "your friend" : `all ${share.members.length} friends`}, at once.`}</p>
            <p>Positions your friends already hold are left as they are: only they can close their own positions.</p>
          </ConfirmDialog>
          <ConfirmDialog
            open={typeof confirm === "object" && confirm !== null}
            onClose={() => setConfirm(null)}
            title={typeof confirm === "object" && confirm ? `Remove ${confirm.name}?` : ""}
            action="Remove"
            danger
            pending={pending}
            onConfirm={() => typeof confirm === "object" && confirm && run(() => removeCopyShareFriend(share.id, confirm.remove), async () => (toast.success("Removed. Their copying has stopped."), setConfirm(null), await after()))}
          >
            <p>Their copying of this strategy stops at once, and they can&apos;t start it again without a new invitation.</p>
            <p>Positions they already hold are left as they are.</p>
          </ConfirmDialog>
        </>
      )}
    </div>
  )
}

// A friend's strategy, opened from anywhere an account can be: what it is, and how to stop following it.
export function SharedSheet({ account, onClose }: { account: AccountView; onClose: () => void }) {
  const { state, refresh } = useCopy()
  const router = useRouter()
  const { pending, run } = useAction()
  const [confirm, setConfirm] = useState(false)
  const positions = state.positions.filter((p) => p.accountId === account.id && !p.simulated)
  return (
    <>
      <Sheet
        open
        onClose={onClose}
        title={account.name}
        description={`${account.connectedBy} · ${account.platform}`}
        footer={
          <button type="button" disabled={pending} className={cn(linkBtn, "text-[var(--loss)]")} onClick={() => setConfirm(true)}>
            Stop following
          </button>
        }
      >
        <div className="flex flex-wrap items-center gap-2">
          <HealthPill health={account.health} />
          <Pill tone="none">Shared strategy</Pill>
        </div>
        <p className="rounded-lg border border-dashed p-2.5 text-sm text-muted-foreground">A friend&apos;s account. You can copy its trades onto your own broker accounts; you can&apos;t trade on it, and its balance is not shown to you.</p>
        <div>
          <p className="text-[11px] font-semibold tracking-wide text-muted-foreground uppercase">Your groups on it</p>
          {account.groups.length === 0 ? (
            <p className="mt-1 text-sm text-muted-foreground">None yet. Create a Copy Group and choose this strategy as its Leader.</p>
          ) : (
            <ul className="mt-1 divide-y text-sm">
              {account.groups.map((g) => (
                <li key={g.id} className="py-1.5">
                  <Link href={`/copy-trading/cockpit?group=${g.id}`} className="font-medium hover:underline">
                    {g.name}
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </div>
        {positions.length > 0 && (
          <div>
            <p className="text-[11px] font-semibold tracking-wide text-muted-foreground uppercase">Open now</p>
            <ul className="mt-1 divide-y text-sm">
              {positions.map((p, i) => (
                <li key={i} className="py-1.5 tabular-nums">
                  {p.side === "long" ? "BUY" : "SELL"} {formatQuantity(p.quantity)} {p.symbol}
                </li>
              ))}
            </ul>
          </div>
        )}
        <p className="flex items-start gap-1.5 text-xs text-muted-foreground">
          <ShieldCheck className="mt-0.5 size-3.5 shrink-0 text-primary" aria-hidden /> {RULES}
        </p>
      </Sheet>
      <ConfirmDialog
        open={confirm}
        onClose={() => setConfirm(false)}
        title={`Stop following “${account.name}”?`}
        action="Stop following"
        danger
        pending={pending}
        onConfirm={() => account.shared && run(() => leaveCopyShare(account.shared!.shareId), async () => (toast.success("You no longer follow it."), setConfirm(false), onClose(), await refresh(), router.refresh()))}
      >
        <p>Your groups that copy it stop copying. Positions you already hold are left as they are: close them yourself in the Cockpit if you want to.</p>
        <p>To follow it again you need a new invitation.</p>
      </ConfirmDialog>
    </>
  )
}

// Connection page: the strategies friends share with the trader, and the ones the trader shares.
export function SharedStrategies({ onOpen }: { onOpen: (accountId: number) => void }) {
  const { state, account } = useCopy()
  if (!state.shared.length && !state.shares.length)
    return (
      <Section title="Shared strategies" description="Share a strategy with friends, or copy one a friend shares with you. Broker accounts only.">
        <p className="text-sm text-muted-foreground">To share one of your broker accounts, open its Manage panel and choose Share with friends. To copy a friend&apos;s strategy, open the invitation link they send you.</p>
      </Section>
    )
  return (
    <Section title="Shared strategies" description="Strategies friends share with you, and the ones you share. Broker accounts only.">
      <ul className="grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
        {state.shared.map((a) => (
          <li key={`in${a.id}`}>
            <button type="button" onClick={() => onOpen(a.id)} className="flex w-full items-center gap-3 rounded-xl border bg-card p-3 text-start transition-colors hover:border-primary/40 focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none">
              <span className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
                <Users className="size-4" aria-hidden />
              </span>
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm font-semibold">{a.name}</span>
                <span className="block truncate text-xs text-muted-foreground">
                  {a.connectedBy} · {a.groups.length ? `${a.groups.length} ${a.groups.length === 1 ? "group" : "groups"} of yours` : "not copied yet"}
                </span>
              </span>
              <HealthPill health={a.health} />
            </button>
          </li>
        ))}
        {state.shares.map((s) => (
          <li key={`out${s.id}`}>
            <button type="button" onClick={() => onOpen(s.accountId)} className="flex w-full items-center gap-3 rounded-xl border bg-card p-3 text-start transition-colors hover:border-primary/40 focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none">
              <span className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-amber-500/10 text-amber-600 dark:text-amber-400">
                <Link2 className="size-4" aria-hidden />
              </span>
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm font-semibold">{s.name}</span>
                <span className="block truncate text-xs text-muted-foreground">
                  You share {account(s.accountId)?.name ?? "an account"} · {s.members.length} {s.members.length === 1 ? "friend" : "friends"}
                </span>
              </span>
              <Pill tone={s.status === "active" ? "good" : "warn"}>{s.status === "active" ? "Shared" : "Closed"}</Pill>
            </button>
          </li>
        ))}
      </ul>
    </Section>
  )
}

// The invitation page: what is offered, on what terms, and Accept.
export function JoinInvite({ token, invite }: { token: string; invite: InviteView | null }) {
  const router = useRouter()
  const { pending, run } = useAction()
  const [attested, setAttested] = useState(false)
  // asked before it is so, and theirs to change afterwards on the Friends page
  const [shareResults, setShareResults] = useState(true)
  if (!invite) {
    return (
      <div className="mx-auto max-w-lg rounded-2xl border bg-card p-6 text-center">
        <p className="text-base font-semibold">This invitation is no longer valid</p>
        <p className="mt-1 text-sm text-muted-foreground">The link was replaced, or the strategy is no longer shared. Ask your friend for a new one.</p>
        <Link href="/copy-trading/connection" className={cn(linkBtn, "mt-4")}>
          Open Copy Trading
        </Link>
      </div>
    )
  }
  const closed = invite.state === "closed" || invite.state === "full"
  return (
    <div className="mx-auto max-w-lg rounded-2xl border bg-card p-6">
      <span className="flex size-11 items-center justify-center rounded-xl bg-primary/10 text-primary">
        <Users className="size-5" aria-hidden />
      </span>
      <p className="mt-3 text-xs font-semibold tracking-wide text-muted-foreground uppercase">Shared strategy</p>
      <h1 className="text-2xl font-bold tracking-tight">{invite.name}</h1>
      <p className="mt-1 text-sm text-muted-foreground">
        Shared by {invite.owner} · {invite.platform}
      </p>
      <ul className="mt-4 space-y-2 text-sm">
        <li>You copy its trades onto your own accounts, at sizes and limits you choose. Nothing is copied until you create a Copy Group with it and switch it on.</li>
        <li>You see its trades and nothing else: not its balance, not its login. You can never trade on it.</li>
        <li className="font-medium">{RULES}</li>
        <li className="text-muted-foreground">Copying is your own decision and your own risk. {invite.owner} is not advising you, and TradeLoop doesn&apos;t check or recommend any strategy.</li>
      </ul>
      {invite.state === "own" ? (
        <p className="mt-4 rounded-lg border border-dashed p-3 text-sm text-muted-foreground">This is your own strategy: this is what your friends see when they open the link.</p>
      ) : invite.state === "joined" ? (
        <div className="mt-4">
          <p className="text-sm text-[var(--gain)]">You already follow this strategy.</p>
          <Link href="/copy-trading/connection" className={cn(linkBtnPrimary, "mt-3")}>
            Open Copy Trading
          </Link>
        </div>
      ) : invite.state === "paused" ? (
        <p className="mt-4 rounded-lg border border-dashed p-3 text-sm text-muted-foreground">{invite.owner} has paused your copying of this strategy. It can be switched back on when they resume it: the link doesn&apos;t change that.</p>
      ) : closed ? (
        <p className="mt-4 rounded-lg border border-dashed p-3 text-sm text-muted-foreground">{invite.state === "full" ? "This strategy already has as many friends as it allows." : "This strategy isn't taking new friends at the moment."} Ask {invite.owner} about it.</p>
      ) : (
        <div className="mt-4 space-y-3">
          <label className="flex cursor-pointer items-start gap-2 text-sm">
            <input type="checkbox" className="mt-0.5 size-4 shrink-0 accent-[var(--primary)]" checked={attested} onChange={(e) => setAttested(e.target.checked)} />
            <span>I will copy it only to my own accounts with a broker, never to a prop-firm account.</span>
          </label>
          <label className="flex cursor-pointer items-start gap-2 text-sm">
            <input type="checkbox" className="mt-0.5 size-4 shrink-0 accent-[var(--primary)]" checked={shareResults} onChange={(e) => setShareResults(e.target.checked)} />
            <span>
              Let {invite.owner} see how my copies of it do: how many I hold and their profit or loss. <span className="text-muted-foreground">Never my balance, my account or my other trades. Optional, and I can change it later.</span>
            </span>
          </label>
          <button type="button" disabled={pending || !attested} className={cn(linkBtnPrimary, "h-10 px-4")} onClick={() => run(() => acceptCopyInvite(token, attested, shareResults), async () => (toast.success(`“${invite.name}” was added. Create a Copy Group to start copying it.`), router.push("/copy-trading/connection")))}>
            {pending ? "Adding…" : "Follow this strategy"}
          </button>
        </div>
      )}
    </div>
  )
}
