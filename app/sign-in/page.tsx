import { redirect } from "next/navigation"
import { headers } from "next/headers"
import { auth, googleAuthEnabled, githubAuthEnabled } from "@/lib/auth"
import { AuthForm } from "@/components/auth-form"

export default async function SignInPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string; via?: string }>
}) {
  const { next, via } = await searchParams
  const redirectTo = next && next.startsWith("/") ? next : "/dashboard"
  const session = await auth.api.getSession({ headers: await headers() })
  // Sent here by the affiliate portal on its own subdomain: a session that
  // exists here but wasn't visible there is an older, host-only cookie. Going
  // back would bounce forever, so they sign in once more — which sets a cookie
  // every subdomain can read.
  if (session?.user && via !== "affiliate") redirect(redirectTo)
  return <AuthForm mode="sign-in" redirectTo={redirectTo} googleEnabled={googleAuthEnabled} githubEnabled={githubAuthEnabled} />
}
