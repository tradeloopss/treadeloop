import { AuthCard } from "@/components/auth-card"
import { ForgotPasswordForm } from "@/components/password-reset-forms"
import { getT } from "@/lib/i18n/server"

export default async function ForgotPasswordPage({ searchParams }: { searchParams: Promise<{ email?: string }> }) {
  const { email } = await searchParams
  const t = await getT()
  return (
    <AuthCard title={t("Reset your password")} subtitle={t("We'll email you a link to choose a new one.")}>
      <ForgotPasswordForm initialEmail={email ?? ""} />
    </AuthCard>
  )
}
