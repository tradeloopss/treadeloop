import { AuthCard } from "@/components/auth-card"
import { TwoFactorForm } from "@/components/two-factor-form"

export default async function TwoFactorPage({ searchParams }: { searchParams: Promise<{ next?: string }> }) {
  const { next } = await searchParams
  return (
    <AuthCard title="Two-step verification" subtitle="Enter the 6-digit code from your authenticator app.">
      <TwoFactorForm next={next && next.startsWith("/") ? next : "/dashboard"} />
    </AuthCard>
  )
}
