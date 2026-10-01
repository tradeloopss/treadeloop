"use client"

import { useEffect } from "react"
import { claimReferral } from "@/app/actions/affiliate"

// Reports a referral-link visit. Mounted once in the root layout; does nothing
// unless the page was opened with ?ref=. It sends only what is already in the
// address bar — the server works out the affiliate, the campaign and the click,
// and answers with a signed httpOnly cookie.
export function AffiliateTracker() {
  useEffect(() => {
    const q = new URLSearchParams(window.location.search)
    const ref = q.get("ref")
    if (!ref || !/^[A-Za-z0-9_-]{3,24}$/.test(ref)) return
    // One report per page load of a given link (React re-mounts, back/forward).
    const once = `tl_aff_sent:${window.location.pathname}${window.location.search}`
    try {
      if (sessionStorage.getItem(once)) return
      sessionStorage.setItem(once, "1")
    } catch {}
    void fetch("/api/aff/click", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "same-origin",
      keepalive: true,
      body: JSON.stringify({
        ref,
        lk: q.get("lk"),
        landing: window.location.pathname,
        referrer: document.referrer || null,
        utm_source: q.get("utm_source"),
        utm_medium: q.get("utm_medium"),
        utm_campaign: q.get("utm_campaign"),
        utm_content: q.get("utm_content"),
      }),
    }).catch(() => {})
  }, [])
  return null
}

// Rendered by the app layout for a just-created account that still carries an
// attribution cookie: asks the server (once) to record who referred it.
export function AffiliateClaim() {
  useEffect(() => {
    try {
      if (sessionStorage.getItem("tl_aff_claimed")) return
      sessionStorage.setItem("tl_aff_claimed", "1")
    } catch {}
    void claimReferral()
  }, [])
  return null
}
