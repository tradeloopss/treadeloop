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
                  // Google only accepts callback URLs listed on the OAuth
                  // client, and production's lists https://tradeloop.pro/...
                  // while the site is served from www. — so the default
                  // ${baseURL}/api/auth/callback/google is refused with
                  // redirect_uri_mismatch. Pointing Google at the listed apex
                  // URL works because Vercel 308s it to www with the query
                  // intact, where the state cookie lives. Unset (local dev),
                  // the default localhost callback is used.
                  ...(process.env.GOOGLE_REDIRECT_URI ? { redirectURI: process.env.GOOGLE_REDIRECT_URI } : {}),
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
        ]
      : []),
  ],
  session: {
    expiresIn: 60 * 60 * 24 * 7, // 7 days
    updateAge: 60 * 60 * 24, // 1 day
  },
  ...(process.env.NODE_ENV === "development"
    ? {
        advanced: {
          // Required by the cross-site v0 preview iframe. Without these
          // attributes, login succeeds but the next request appears signed out.
          defaultCookieAttributes: {
            sameSite: "none" as const,
            secure: true,
          },
        },
      }
    : {}),
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
    // After twoFactor on purpose — see lib/security.ts.
    securityEventsPlugin(),
    // Must stay last so it sees the cookies every other plugin sets.
    nextCookies(),
  ],
})
