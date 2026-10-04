import { Activity, BookOpen, CreditCard, Database, FileUp, FlaskConical, Gauge, Gift, Handshake, LifeBuoy, Lock, Megaphone, PlugZap, ScrollText, Settings, ShieldCheck, SlidersHorizontal, Users, type LucideIcon } from "lucide-react"
import type { NavIcon } from "@/lib/admin/nav"

// One icon per admin section, shared by both dashboards.
export const NAV_ICONS: Record<NavIcon, LucideIcon> = {
  overview: Gauge,
  users: Users,
  billing: CreditCard,
  brokers: PlugZap,
  analytics: Activity,
  announcements: Megaphone,
  audit: ScrollText,
  team: ShieldCheck,
  support: LifeBuoy,
  security: Lock,
  imports: FileUp,
  content: BookOpen,
  system: Database,
  propRules: SlidersHorizontal,
  cases: Gift,
  affiliates: Handshake,
  settings: Settings,
  features: FlaskConical,
}
