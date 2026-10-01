"use client"

import type React from "react"
import { useState } from "react"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Textarea } from "@/components/ui/textarea"
import { useAction } from "./use-action"

type Result = { ok: true; message?: string } | { ok: false; error: string }

// A button that asks before it acts. With `reason`, the dialog also collects a
// note that is passed to the action (rejections, reversals, failures).
export function ConfirmButton({
  children,
  title,
  description,
  confirmLabel = "Confirm",
  destructive,
  action,
  reason,
  variant = "outline",
  size = "sm",
  className,
  disabled,
}: {
  children: React.ReactNode
  title: string
  description?: React.ReactNode
  confirmLabel?: string
  destructive?: boolean
  action: (reason: string) => Promise<Result>
  reason?: { label: string; required?: boolean; placeholder?: string }
  variant?: "default" | "outline" | "ghost" | "destructive" | "secondary"
  size?: "default" | "sm" | "xs"
  className?: string
  disabled?: boolean
}) {
  const [open, setOpen] = useState(false)
  const [note, setNote] = useState("")
  const { pending, run } = useAction()
  return (
    <>
      <Button type="button" variant={variant} size={size} className={className} disabled={disabled || pending} onClick={() => setOpen(true)}>
        {children}
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>{title}</DialogTitle>
            {description && <DialogDescription>{description}</DialogDescription>}
          </DialogHeader>
          {reason && (
            <label className="flex flex-col gap-1.5 text-xs text-muted-foreground">
              {reason.label}
              <Textarea value={note} onChange={(e) => setNote(e.target.value)} rows={3} maxLength={400} placeholder={reason.placeholder} />
            </label>
          )}
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setOpen(false)} disabled={pending}>
              Cancel
            </Button>
            <Button
              type="button"
              variant={destructive ? "destructive" : "default"}
              disabled={pending || (reason?.required && !note.trim())}
              onClick={() =>
                run(
                  () => action(note.trim()),
                  () => {
                    setOpen(false)
                    setNote("")
                  }
                )
              }
            >
              {pending ? "Working…" : confirmLabel}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  )
}
