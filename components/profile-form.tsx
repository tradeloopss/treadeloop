"use client"

import type React from "react"
import { useState } from "react"
import { useRouter } from "next/navigation"
import { authClient } from "@/lib/auth-client"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Card } from "@/components/ui/card"
import { toast } from "sonner"

export function ProfileForm({
  name: initialName,
  email: initialEmail,
  image: initialImage,
}: {
  name: string
  email: string
  image: string | null
}) {
  const router = useRouter()
  const [name, setName] = useState(initialName)
  const [image, setImage] = useState(initialImage ?? "")
  const [email, setEmail] = useState(initialEmail)
  const [savingProfile, setSavingProfile] = useState(false)
  const [savingEmail, setSavingEmail] = useState(false)

  async function onSaveProfile(e: React.FormEvent) {
    e.preventDefault()
    setSavingProfile(true)
    try {
      const { error } = await authClient.updateUser({ name, image: image.trim() === "" ? null : image.trim() })
      if (error) throw new Error(error.message ?? "Could not update profile")
      toast.success("Profile updated")
      router.refresh()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not update profile")
    } finally {
      setSavingProfile(false)
    }
  }

  async function onSaveEmail(e: React.FormEvent) {
    e.preventDefault()
    if (email === initialEmail) return
    setSavingEmail(true)
    try {
      const { error } = await authClient.changeEmail({ newEmail: email })
      if (error) throw new Error(error.message ?? "Could not update email")
      toast.success("Email updated")
      router.refresh()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not update email")
      setEmail(initialEmail)
    } finally {
      setSavingEmail(false)
    }
  }

  return (
    <Card className="max-w-lg space-y-6 p-5">
      <form onSubmit={onSaveProfile} className="space-y-4">
        <div className="flex items-center gap-4">
          <div className="flex size-14 items-center justify-center overflow-hidden rounded-full bg-primary/15 text-lg font-medium text-primary">
            {image ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={image} alt="" className="size-full object-cover" />
            ) : (
              name.charAt(0).toUpperCase()
            )}
          </div>
          <div className="flex-1 space-y-1.5">
            <Label htmlFor="image">Avatar URL</Label>
            <Input id="image" value={image} onChange={(e) => setImage(e.target.value)} placeholder="https://…" />
          </div>
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="name">Display name</Label>
          <Input id="name" value={name} onChange={(e) => setName(e.target.value)} required />
        </div>
        <Button type="submit" disabled={savingProfile}>
          {savingProfile ? "Saving…" : "Save profile"}
        </Button>
      </form>

      <form onSubmit={onSaveEmail} className="space-y-1.5 border-t pt-5">
        <Label htmlFor="email">Email</Label>
        <div className="flex gap-2">
          <Input id="email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} required />
          <Button type="submit" variant="outline" disabled={savingEmail || email === initialEmail}>
            {savingEmail ? "Saving…" : "Update"}
          </Button>
        </div>
      </form>
    </Card>
  )
}
