import Link from "next/link"
import { Card } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Sparkles } from "lucide-react"

export function UpgradePrompt({ feature }: { feature: string }) {
  return (
    <Card className="flex flex-col items-center gap-3 p-8 text-center">
      <Sparkles className="size-6 text-primary" />
      <div>
        <p className="font-medium">{feature} is a Pro feature</p>
        <p className="mt-1 text-sm text-muted-foreground">Upgrade to unlock it, plus unlimited accounts and live broker sync.</p>
      </div>
      <Button nativeButton={false} render={<Link href="/pricing">View plans</Link>} />
    </Card>
  )
}
