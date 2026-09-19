import Link from "next/link"
import { AuthCard } from "@/components/auth-card"
import { ResetPasswordForm } from "@/components/password-reset-forms"
import { getT } from "@/lib/i18n/server"

// Better Auth's emailed link validates the token, then lands here with
// ?token=… — or ?error=INVALID_TOKEN once it's used or expired.
export default async function ResetPasswordPage({ searchParams }: { searchParams: Promise<{ token?: string; error?: string }> }) {
  const { token, error } = await searchParams
  const t = await getT()
  if (!token || error) {
    return (
      <AuthCard title={t("Link expired")} subtitle={t("This reset link has already been used or is more than an hour old.")}>
        <Link href="/forgot-password" className="block text-center text-sm font-medium text-primary hover:underline">
          {t("Send a new link")}
        </Link>
      </AuthCard>
    )
  }
  return (
    <AuthCard title={t("Choose a new password")} subtitle={t("You'll be signed out of your other devices.")}>
      <ResetPasswordForm token={token} />
    </AuthCard>
  )
}
