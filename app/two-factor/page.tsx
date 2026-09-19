import { AuthCard } from "@/components/auth-card"
import { TwoFactorForm } from "@/components/two-factor-form"
import { getT } from "@/lib/i18n/server"

export default async function TwoFactorPage({ searchParams }: { searchParams: Promise<{ next?: string }> }) {
  const { next } = await searchParams
  const t = await getT()
  return (
    <AuthCard title={t("Two-step verification")} subtitle={t("Enter the 6-digit code from your authenticator app.")}>
      <TwoFactorForm next={next && next.startsWith("/") ? next : "/dashboard"} />
    </AuthCard>
  )
}
