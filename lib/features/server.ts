import { cache } from "react"
import { headers } from "next/headers"
import { notFound } from "next/navigation"
import { auth } from "@/lib/auth"
import { getAdmin } from "@/lib/admin/guard"
import { getAppSetting, setAppSetting } from "@/lib/app-settings"
import { DEFAULT_RELEASES, canUseFeature, normalizeReleases, type FeatureKey, type Releases, type Stage } from "./release"

// Who gets a feature that is being rolled out (lib/features/release.ts). The
// stage is one app setting; "is this person on the team" comes from the admin
// guard, so an admin's "log in as user" session is treated as that user.

const KEY = "feature_releases"

export const getReleases = cache(async (): Promise<Releases> => {
  try {
    return normalizeReleases(await getAppSetting(KEY))
  } catch {
    // The app must open even if the setting can't be read — with nothing released.
    return { ...DEFAULT_RELEASES }
  }
})

export async function saveRelease(feature: FeatureKey, stage: Stage): Promise<Releases> {
  const next = { ...normalizeReleases(await getAppSetting(KEY)), [feature]: stage }
  await setAppSetting(KEY, next)
  return next
}

export type FeatureAccess = { userId: string | null; isAdmin: boolean; releases: Releases; can: Record<FeatureKey, boolean> }

// For the app shell and the dashboard: what this visitor may see. Cached per request.
export const featureAccess = cache(async (): Promise<FeatureAccess> => {
  const [admin, releases, session] = await Promise.all([getAdmin(), getReleases(), auth.api.getSession({ headers: await headers() })])
  const isAdmin = !!admin
  const signedIn = !!session?.user
  return {
    userId: session?.user?.id ?? null,
    isAdmin,
    releases,
    can: { edge_lab: signedIn && canUseFeature(releases.edge_lab, isAdmin), psychology: signedIn && canUseFeature(releases.psychology, isAdmin), copy_trading: signedIn && canUseFeature(releases.copy_trading, isAdmin) },
  }
})

// For a feature's pages: anyone it isn't released to gets a 404, so a feature
// in admin testing doesn't advertise that it exists.
export async function requireFeature(feature: FeatureKey): Promise<{ userId: string; isAdmin: boolean; stage: Stage; access: FeatureAccess }> {
  const access = await featureAccess()
  if (!access.userId || !access.can[feature]) notFound()
  return { userId: access.userId, isAdmin: access.isAdmin, stage: access.releases[feature], access }
}

// For a feature's server actions: the same check, reported as an error.
export async function assertFeature(feature: FeatureKey): Promise<{ userId: string; isAdmin: boolean }> {
  const access = await featureAccess()
  if (!access.userId) throw new Error("Sign in to continue.")
  if (!access.can[feature]) throw new Error("This feature isn't available on your account yet.")
  return { userId: access.userId, isAdmin: access.isAdmin }
}
