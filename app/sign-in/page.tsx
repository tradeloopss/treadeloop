import { redirect } from "next/navigation"
import { headers } from "next/headers"
import { auth, googleAuthEnabled, githubAuthEnabled } from "@/lib/auth"
import { AuthForm } from "@/components/auth-form"

export default async function SignInPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string }>
}) {
  const { next } = await searchParams
  const redirectTo = next && next.startsWith("/") ? next : "/dashboard"
  const session = await auth.api.getSession({ headers: await headers() })
  if (session?.user) redirect(redirectTo)
  return <AuthForm mode="sign-in" redirectTo={redirectTo} googleEnabled={googleAuthEnabled} githubEnabled={githubAuthEnabled} />
}
