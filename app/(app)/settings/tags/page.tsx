import { getTagGroups } from "@/app/actions/tags"
import { TagsView } from "@/components/settings/pages/tags-view"

export const metadata = { title: "Tags" }

export default async function TagsSettingsPage() {
  const groups = await getTagGroups()
  return <TagsView groups={groups} />
}
