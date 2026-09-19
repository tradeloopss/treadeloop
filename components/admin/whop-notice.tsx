import { ExternalLink, KeyRound } from "lucide-react"

// Shown in place of a Whop-backed panel when the API call failed — most
// often because the key lacks a permission, which the message names.
export function WhopUnavailable({ error, missingScope }: { error: string; missingScope: string | null }) {
  return (
    <div className="rounded-lg border border-dashed p-4 text-sm">
      <p className="flex items-start gap-2">
        <KeyRound className="mt-0.5 size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
        <span>
          {missingScope ? (
            <>
              This needs the Whop API key to have the <code className="rounded bg-muted px-1 font-mono text-xs">{missingScope}</code> permission. Add it to the key in Whop&apos;s developer settings, put the key in
              Vercel as <code className="rounded bg-muted px-1 font-mono text-xs">WHOP_API_KEY</code>, and redeploy.
            </>
          ) : (
            error
          )}
        </span>
      </p>
      <a href="https://whop.com/dashboard" target="_blank" rel="noreferrer" className="mt-3 inline-flex items-center gap-1.5 text-xs font-medium text-primary hover:underline">
        Open Whop dashboard <ExternalLink className="size-3" />
      </a>
    </div>
  )
}
