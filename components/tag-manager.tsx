"use client"

import type React from "react"
import { useState, useTransition } from "react"
import {
  createTagGroup,
  renameTagGroup,
  deleteTagGroup,
  addTagOption,
  deleteTagOption,
} from "@/app/actions/tags"
import { Button } from "@/components/ui/button"
import { Card } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
} from "@/components/ui/dropdown-menu"
import { cn } from "@/lib/utils"
import { Tag, MoreHorizontal, X, Plus } from "lucide-react"

const COLORS = ["violet", "pink", "yellow", "red", "blue", "emerald"] as const
type TagColor = (typeof COLORS)[number]

const COLOR_CLASSES: Record<TagColor, string> = {
  violet: "text-violet-500",
  pink: "text-pink-500",
  yellow: "text-yellow-500",
  red: "text-red-500",
  blue: "text-blue-500",
  emerald: "text-emerald-500",
}

export interface TagGroupData {
  id: number
  name: string
  color: string
  tags: { id: number; name: string }[]
}

export function TagManager({ groups }: { groups: TagGroupData[] }) {
  return (
    <Card className="max-w-2xl space-y-1 p-5">
      <div>
        <h2 className="font-medium">Custom Tagging System</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          Organize trades with custom tags for setups, emotions, mistakes, and more.
        </p>
      </div>

      <div className="mt-3 divide-y">
        {groups.map((group) => (
          <TagGroupRow key={group.id} group={group} />
        ))}
      </div>

      <NewGroupForm />
    </Card>
  )
}

function TagGroupRow({ group }: { group: TagGroupData }) {
  const [pending, startTransition] = useTransition()
  const [editing, setEditing] = useState(false)
  const [name, setName] = useState(group.name)
  const [newTag, setNewTag] = useState("")
  const color = (COLORS as readonly string[]).includes(group.color) ? (group.color as TagColor) : "violet"

  function commitRename() {
    setEditing(false)
    const trimmed = name.trim()
    if (!trimmed || trimmed === group.name) {
      setName(group.name)
      return
    }
    startTransition(() => renameTagGroup(group.id, trimmed))
  }

  function onAddTag(e: React.FormEvent) {
    e.preventDefault()
    const trimmed = newTag.trim()
    if (!trimmed) return
    setNewTag("")
    startTransition(() => addTagOption(group.id, trimmed))
  }

  return (
    <div className="py-3">
      <div className="flex items-center gap-2">
        <Tag className={cn("size-4 shrink-0", COLOR_CLASSES[color])} />
        {editing ? (
          <Input
            autoFocus
            value={name}
            onChange={(e) => setName(e.target.value)}
            onBlur={commitRename}
            onKeyDown={(e) => {
              if (e.key === "Enter") commitRename()
              if (e.key === "Escape") {
                setName(group.name)
                setEditing(false)
              }
            }}
            className="h-7 max-w-40 text-sm font-semibold"
          />
        ) : (
          <span className="text-sm font-semibold">{group.name}</span>
        )}

        <DropdownMenu>
          <DropdownMenuTrigger
            render={
              <Button variant="ghost" size="icon" className="ml-auto size-7" disabled={pending}>
                <MoreHorizontal className="size-4" />
              </Button>
            }
          />
          <DropdownMenuContent align="end">
            <DropdownMenuItem onClick={() => setEditing(true)}>Rename</DropdownMenuItem>
            <DropdownMenuItem variant="destructive" onClick={() => startTransition(() => deleteTagGroup(group.id))}>
              Delete group
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>

      <div className="mt-2 flex flex-wrap items-center gap-1.5 pl-6">
        {group.tags.map((tag) => (
          <span
            key={tag.id}
            className="flex items-center gap-1 rounded-full bg-muted px-2.5 py-1 text-xs font-medium text-foreground"
          >
            {tag.name}
            <button
              type="button"
              aria-label={`Remove ${tag.name}`}
              onClick={() => startTransition(() => deleteTagOption(tag.id))}
              className="text-muted-foreground hover:text-foreground"
            >
              <X className="size-3" />
            </button>
          </span>
        ))}
        <form onSubmit={onAddTag} className="flex items-center">
          <Input
            value={newTag}
            onChange={(e) => setNewTag(e.target.value)}
            placeholder="Add tag…"
            className="h-7 w-28 rounded-full border-dashed text-xs"
          />
        </form>
      </div>
    </div>
  )
}

function NewGroupForm() {
  const [pending, startTransition] = useTransition()
  const [open, setOpen] = useState(false)
  const [name, setName] = useState("")
  const [color, setColor] = useState<TagColor>("violet")

  function onSubmit(e: React.FormEvent) {
    e.preventDefault()
    const trimmed = name.trim()
    if (!trimmed) return
    startTransition(() => createTagGroup(trimmed, color))
    setName("")
    setOpen(false)
  }

  if (!open) {
    return (
      <Button variant="outline" size="sm" className="mt-3" onClick={() => setOpen(true)}>
        <Plus className="size-4" />
        Add tag group
      </Button>
    )
  }

  return (
    <form onSubmit={onSubmit} className="mt-3 flex flex-wrap items-center gap-2">
      <Input
        autoFocus
        value={name}
        onChange={(e) => setName(e.target.value)}
        placeholder="Group name (e.g. Setups)"
        className="h-8 w-48 text-sm"
      />
      <div className="flex items-center gap-1">
        {COLORS.map((c) => (
          <button
            key={c}
            type="button"
            aria-label={c}
            onClick={() => setColor(c)}
            className={cn(
              "size-5 rounded-full ring-offset-2 ring-offset-background",
              c === "violet" && "bg-violet-500",
              c === "pink" && "bg-pink-500",
              c === "yellow" && "bg-yellow-500",
              c === "red" && "bg-red-500",
              c === "blue" && "bg-blue-500",
              c === "emerald" && "bg-emerald-500",
              color === c && "ring-2 ring-foreground",
            )}
          />
        ))}
      </div>
      <Button type="submit" size="sm" disabled={pending}>
        Add
      </Button>
      <Button type="button" variant="ghost" size="sm" onClick={() => setOpen(false)}>
        Cancel
      </Button>
    </form>
  )
}
