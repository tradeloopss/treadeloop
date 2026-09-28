import { AccountsSection } from "@/components/accounts/accounts-section"

// Connecting Rithmic (login + account discovery + history) and "Sync all"
// run as server actions on this route and can take up to a minute.
export const maxDuration = 60

export default async function AccountsPage({ searchParams }: { searchParams: Promise<{ connect?: string; tradovate?: string; tradovate_error?: string }> }) {
  const { connect, tradovate, tradovate_error } = await searchParams
  return <AccountsSection connect={connect} tradovateParam={tradovate} tradovateErrorCode={tradovate_error} label="/accounts" />
}
