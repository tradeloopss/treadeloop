"use client"

import { useTransition } from "react"
import { useRouter } from "next/navigation"
import Link from "next/link"
import { clonePlaybook } from "@/app/actions/playbooks"
import { Button } from "@/components/ui/button"
import { Copy } from "lucide-react"
import { toast } from "sonner"

export function ClonePlaybookButton({ token, isSignedIn }: { token: string; isSignedIn: boolean }) {
  const router = useRouter()
  const [pending, startTransition] = useTransition()

  if (!isSignedIn) {
    return (
      <Button
        nativeButton={false}
        render={
          <Link href={`/sign-in?next=/p/${token}`}>
            <Copy className="size-4" /> Sign in to save a copy
          </Link>
        }
      />
    )
  }

  function onClone() {
    startTransition(async () => {
      try {
        await clonePlaybook(token)
        toast.success("Added to your playbooks")
        router.push("/playbooks")
      } catch (err) {
        toast.error(err instanceof Error ? err.message : "Could not save this playbook")
      }
    })
  }

  return (
    <Button onClick={onClone} disabled={pending}>
      <Copy className="size-4" /> {pending ? "Saving…" : "Save a copy to my playbooks"}
    </Button>
  )
}
