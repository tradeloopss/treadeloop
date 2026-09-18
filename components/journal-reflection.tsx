"use client"

import { useState, useTransition } from "react"
import { saveJournalReflection } from "@/app/actions/journal"
import { Button } from "@/components/ui/button"
import { Textarea } from "@/components/ui/textarea"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { toast } from "sonner"

const MOODS = ["Confident", "Calm", "Focused", "Anxious", "Frustrated", "Revenge", "Bored"]

export function JournalReflection({
  date,
  notes,
  mood,
}: {
  date: string
  notes: string | null
  mood: string | null
}) {
  const [pending, startTransition] = useTransition()
  const [moodValue, setMoodValue] = useState(mood ?? "")

  function onSubmit(formData: FormData) {
    formData.set("date", date)
    formData.set("mood", moodValue)
    startTransition(async () => {
      try {
        await saveJournalReflection(formData)
        toast.success("Reflection saved")
      } catch {
        toast.error("Could not save reflection")
      }
    })
  }

  return (
    <form action={onSubmit} className="space-y-3">
      <div className="flex flex-col gap-2 sm:max-w-52">
        <label className="text-xs font-medium text-muted-foreground">Mood / mindset</label>
        <Select value={moodValue} onValueChange={setMoodValue}>
          <SelectTrigger><SelectValue placeholder="How did you feel?" /></SelectTrigger>
          <SelectContent>
            {MOODS.map((m) => (
              <SelectItem key={m} value={m}>{m}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      <Textarea
        name="notes"
        defaultValue={notes ?? ""}
        rows={3}
        placeholder="What went well? What would you do differently? Lessons for tomorrow…"
      />
      <Button type="submit" size="sm" variant="secondary" disabled={pending}>
        {pending ? "Saving…" : "Save reflection"}
      </Button>
    </form>
  )
}
