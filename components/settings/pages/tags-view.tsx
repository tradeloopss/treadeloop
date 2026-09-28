"use client"

import { Tags } from "lucide-react"
import { TagManager, type TagGroupData } from "@/components/tag-manager"
import { SettingsHeader } from "@/components/settings/chrome"
import { useT } from "@/components/locale-provider"

export function TagsView({ groups }: { groups: TagGroupData[] }) {
  const t = useT()
  return (
    <div className="space-y-6">
      <SettingsHeader icon={Tags} title={t("Tags")} />
      <TagManager groups={groups} />
    </div>
  )
}
