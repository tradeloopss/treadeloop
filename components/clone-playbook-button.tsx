"use client"

import { useTransition } from "react"
import { useRouter } from "next/navigation"
import Link from "next/link"
import { clonePlaybook } from "@/app/actions/playbooks"
import { Button } from "@/components/ui/button"
import { Copy } from "lucide-react"
import { toast } from "sonner"
import { useT } from "@/components/locale-provider"

export function ClonePlaybookButton({ token, isSignedIn }: { token: string; isSignedIn: boolean }) {
  const router = useRouter()
  const t = useT()
  const [pending, startTransition] = useTransition()

  if (!isSignedIn) {
    return (
      <Button
        nativeButton={false}
        render={
          <Link href={`/sign-in?next=/p/${token}`}>
            <Copy className="size-4" /> {t("Sign in to save a copy")}
          </Link>
        }
      />
    )
  }

  function onClone() {
    startTransition(async () => {
      try {
        await clonePlaybook(token)
        toast.success(t("Added to your playbooks"))
        router.push("/playbooks")
      } catch (err) {
        toast.error(err instanceof Error ? t(err.message) : t("Could not save this playbook"))
      }
    })
  }

  return (
    <Button onClick={onClone} disabled={pending}>
      <Copy className="size-4" /> {pending ? t("Saving…") : t("Save a copy to my playbooks")}
    </Button>
  )
}
