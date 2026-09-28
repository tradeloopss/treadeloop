"use client"

import { createAuthClient } from "better-auth/react"
import { twoFactorClient, emailOTPClient } from "better-auth/client/plugins"

export const authClient = createAuthClient({
  plugins: [
    emailOTPClient(),
    twoFactorClient({
      // A password sign-in on an account with 2FA stops here and continues
      // on the code page, carrying along where the user was headed.
      onTwoFactorRedirect() {
        const next = new URLSearchParams(window.location.search).get("next")
        window.location.href = `/two-factor${next ? `?next=${encodeURIComponent(next)}` : ""}`
      },
    }),
  ],
})

export const { signIn, signUp, signOut, useSession } = authClient
