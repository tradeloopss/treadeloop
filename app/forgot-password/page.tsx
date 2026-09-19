import { AuthCard } from "@/components/auth-card"
import { ForgotPasswordForm } from "@/components/password-reset-forms"

export default async function ForgotPasswordPage({ searchParams }: { searchParams: Promise<{ email?: string }> }) {
  const { email } = await searchParams
  return (
    <AuthCard title="Reset your password" subtitle="We'll email you a link to choose a new one.">
      <ForgotPasswordForm initialEmail={email ?? ""} />
    </AuthCard>
  )
}
