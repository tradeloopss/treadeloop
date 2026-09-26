// UI-facing types shared between the PropFirm Max server actions and the
// client components. Kept out of the "use server" action file, which may only
// export async functions, and out of the client bundle's runtime (these are
// type-only, so importing them pulls in no server code).
import type { PropMaxAccountView } from "@/lib/propmax/account"

// What the setup picker offers: only firm/program/size/phase combinations we
// actually have sourced rules for — so a user can never bind an account to a
// combination the engine would have to guess at.
export interface CatalogOption {
  id: number // rule_version id
  firmSlug: string
  firmName: string
  programSlug: string
  programName: string
  accountSize: number | null
  phase: string
  confidence: string
  sourceName: string
}

export interface PropMaxData {
  accounts: PropMaxAccountView[]
  catalog: CatalogOption[]
}

// A fired alert as the alert center shows it.
export interface PropMaxAlertView {
  id: number
  accountId: number | null // the trading account, for linking
  accountName: string
  ruleType: string | null
  status: string
  severity: string
  title: string
  body: string
  percentageUsed: number | null
  createdAt: string
}
