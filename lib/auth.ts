import { betterAuth } from "better-auth"
import { nextCookies } from "better-auth/next-js"
import { admin, twoFactor } from "better-auth/plugins"
import { pool } from "@/lib/db"
import { ac, roles, ADMIN_ROLES } from "@/lib/admin/access"
import { sendEmail } from "@/lib/email"
import { securityEventsPlugin } from "@/lib/security"

/** Whether Google OAuth credentials are configured on this deployment. */
export const googleAuthEnabled = Boolean(process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET)

/** Whether GitHub OAuth credentials are configured on this deployment. */
export const githubAuthEnabled = Boolean(process.env.GITHUB_CLIENT_ID && process.env.GITHUB_CLIENT_SECRET)

// The app now lives on its own subdomain (app.tradeloop.pro). OAuth must return
// to that same origin — the one that set the state cookie — or Google refuses
// it (redirect_uri_mismatch) / the callback can't verify the state. So the
// Google callback is pinned to the app origin: GOOGLE_REDIRECT_URI wins if set,
// otherwise it's derived from NEXT_PUBLIC_APP_URL (the app subdomain). Unset
// (local dev), better-auth falls back to ${baseURL}/api/auth/callback/google.
// The same URL must be listed under the OAuth client's Authorized redirect URIs
// in the Google Cloud console.
const appOrigin = process.env.NEXT_PUBLIC_APP_URL?.replace(/\/+$/, "")
const googleRedirectURI =
  process.env.GOOGLE_REDIRECT_URI ?? (appOrigin ? `${appOrigin}/api/auth/callback/google` : undefined)

export const auth = betterAuth({
  appName: "TradeLoop",
  database: pool,
  baseURL:
    process.env.BETTER_AUTH_URL ??
    (process.env.VERCEL_PROJECT_PRODUCTION_URL
      ? `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}`
      : process.env.VERCEL_URL
        ? `https://${process.env.VERCEL_URL}`
        : process.env.V0_RUNTIME_URL),
  emailAndPassword: {
    enabled: true,
    autoSignIn: true,
    // The link lands on /reset-password with the token; a successful reset
    // signs the account out everywhere else.
    sendResetPassword: async ({ user, url }) => {
      await sendEmail({
        to: user.email,
        subject: "Reset your TradeLoop password",
        text: `Someone asked to reset the password for your TradeLoop account.

Choose a new password here (the link works for one hour):
${url}

If it wasn't you, ignore this email — your password stays the same.`,
      })
    },
    resetPasswordTokenExpiresIn: 60 * 60,
    revokeSessionsOnPasswordReset: true,
  },
  // A social provider is only registered when its credentials are actually present,
  // so a deployment without them fails closed rather than offering a button
  // that dead-ends on Google's error page. The UI reads the same flag
  // (googleAuthEnabled / githubAuthEnabled) and hides the button in that case.
  ...(googleAuthEnabled || githubAuthEnabled
    ? {
        socialProviders: {
          ...(googleAuthEnabled
            ? {
                google: {
                  clientId: process.env.GOOGLE_CLIENT_ID!,
                  clientSecret: process.env.GOOGLE_CLIENT_SECRET!,
                  // Pinned to the app subdomain (see googleRedirectURI above) so
                  // Google returns to the origin that started the sign-in.
                  ...(googleRedirectURI ? { redirectURI: googleRedirectURI } : {}),
                },
              }
            : {}),
          ...(githubAuthEnabled
            ? {
                github: {
                  clientId: process.env.GITHUB_CLIENT_ID!,
                  clientSecret: process.env.GITHUB_CLIENT_SECRET!,
                },
              }
            : {}),
        },
      }
    : {}),
  trustedOrigins: [
    ...(process.env.NODE_ENV === "development"
      ? [
          "http://localhost:3000",
          ...(process.env.V0_RUNTIME_URL ? [process.env.V0_RUNTIME_URL] : []),
          ...(process.env.V0_DEV_APP_URL ? [process.env.V0_DEV_APP_URL] : []),
          ...(process.env.V0_BUILD_URL ? [process.env.V0_BUILD_URL] : []),
          ...(process.env.V0_SANDBOX_URL ? [process.env.V0_SANDBOX_URL] : []),
        ]
      : []),
    ...(process.env.NODE_ENV === "production"
      ? [
          ...(process.env.VERCEL_URL ? [`https://${process.env.VERCEL_URL}`] : []),
          ...(process.env.VERCEL_PROJECT_PRODUCTION_URL
            ? [`https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}`]
            : []),
          // The app subdomain, so sign-in/OAuth POSTs from app.<domain> are trusted.
          ...(appOrigin ? [appOrigin] : []),
        ]
      : []),
    // Extra origins allowed to POST to auth — set AUTH_TRUSTED_ORIGINS to a
    // comma-separated list (e.g. https://app.tradeloop.pro,https://tradeloop.pro)
    // when the app moves to its own subdomain.
    ...(process.env.AUTH_TRUSTED_ORIGINS ? process.env.AUTH_TRUSTED_ORIGINS.split(",").map((s) => s.trim()).filter(Boolean) : []),
  ],
  session: {
    expiresIn: 60 * 60 * 24 * 7, // 7 days
    updateAge: 60 * 60 * 24, // 1 day
  },
  // Cookie behaviour: cross-site attributes for the dev preview iframe, and —
  // when AUTH_COOKIE_DOMAIN is set (e.g. ".tradeloop.pro") — a shared cookie
  // domain so a session on app.tradeloop.pro is recognised across subdomains.
  // Neither is applied unless its env/condition is present, so the current
  // single-domain setup is unchanged.
  ...(() => {
    const advanced: Record<string, unknown> = {}
    if (process.env.NODE_ENV === "development") advanced.defaultCookieAttributes = { sameSite: "none" as const, secure: true }
    if (process.env.AUTH_COOKIE_DOMAIN) advanced.crossSubDomainCookies = { enabled: true, domain: process.env.AUTH_COOKIE_DOMAIN }
    return Object.keys(advanced).length ? { advanced } : {}
  })(),
  plugins: [
    admin({
      ac,
      roles,
      adminRoles: [...ADMIN_ROLES],
      // "Log in as user" sessions are short on purpose; every one is also
      // recorded in the admin audit log.
      impersonationSessionDuration: 30 * 60,
      bannedUserMessage: "This account has been suspended. Contact support@tradeloop.pro.",
    }),
    // Authenticator-app codes with backup codes. Google-only accounts have no
    // password to confirm with, so they can turn it on without one.
    twoFactor({ issuer: "TradeLoop", allowPasswordless: true }),
    // Sign-up email verification is handled by a custom code flow that runs
    // BEFORE the account is created (app/actions/auth-helpers.ts), so no
    // email-OTP plugin is registered here.
    // After twoFactor on purpose — see lib/security.ts.
    securityEventsPlugin(),
    // Must stay last so it sees the cookies every other plugin sets.
    nextCookies(),
  ],
})
