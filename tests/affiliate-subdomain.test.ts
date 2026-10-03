import { test } from "node:test"
import assert from "node:assert/strict"
import { NextRequest } from "next/server"

// The affiliate portal on its own subdomain. The env has to be in place before
// the modules read it, so they are imported inside the tests.
process.env.NEXT_PUBLIC_APP_URL = "https://app.tradeloop.pro"
process.env.NEXT_PUBLIC_AFFILIATE_URL = "https://affiliate.tradeloop.pro/"

const visit = async (url: string) => {
  const { proxy } = await import("@/proxy")
  const res = proxy(new NextRequest(url, { headers: { host: new URL(url).host } }))
  return { status: res.status, location: res.headers.get("location"), rewrite: res.headers.get("x-middleware-rewrite") }
}

test("affiliate.<domain>: the portal sits at the root, with clean addresses", async () => {
  // the overview and every section are served from the in-app routes
  assert.equal((await visit("https://affiliate.tradeloop.pro/")).rewrite, "https://affiliate.tradeloop.pro/affiliate")
  assert.equal((await visit("https://affiliate.tradeloop.pro/payouts")).rewrite, "https://affiliate.tradeloop.pro/affiliate/payouts")
  assert.equal((await visit("https://affiliate.tradeloop.pro/referrals?status=active&page=2")).rewrite, "https://affiliate.tradeloop.pro/affiliate/referrals?status=active&page=2")
  assert.equal((await visit("https://affiliate.tradeloop.pro/export/payouts")).rewrite, "https://affiliate.tradeloop.pro/affiliate/export/payouts")
  // the V2 dashboard (beta) lives under /v2, with its own sections beneath it
  assert.equal((await visit("https://affiliate.tradeloop.pro/v2")).rewrite, "https://affiliate.tradeloop.pro/affiliate/v2")
  assert.equal((await visit("https://affiliate.tradeloop.pro/v2/wallet?withdraw=1")).rewrite, "https://affiliate.tradeloop.pro/affiliate/v2/wallet?withdraw=1")
  assert.equal((await visit("https://affiliate.tradeloop.pro/v2/campaigns/12")).rewrite, "https://affiliate.tradeloop.pro/affiliate/v2/campaigns/12")
  for (const section of ["analytics", "referrals", "campaigns", "links", "coupons", "earnings", "payouts", "resources", "announcements", "support", "settings", "apply", "terms", "onboarding"]) {
    const r = await visit(`https://affiliate.tradeloop.pro/${section}`)
    assert.deepEqual([r.status, r.rewrite], [200, `https://affiliate.tradeloop.pro/affiliate/${section}`], section)
  }
  // the in-app form of the address lands on the clean one
  assert.deepEqual(await visit("https://affiliate.tradeloop.pro/affiliate/payouts?x=1"), { status: 307, location: "https://affiliate.tradeloop.pro/payouts?x=1", rewrite: null })
  assert.equal((await visit("https://affiliate.tradeloop.pro/affiliate")).location, "https://affiliate.tradeloop.pro/")
})

test("anything else asked for on the affiliate subdomain belongs to the app", async () => {
  for (const path of ["/sign-in?next=/affiliate", "/dashboard", "/admin/affiliates", "/pricing", "/support/12", "/forgot-password"]) {
    const section = path.split(/[/?]/)[1]
    const r = await visit(`https://affiliate.tradeloop.pro${path}`)
    // /support is also a portal page; its sub-pages are not
    if (section === "support") continue
    assert.deepEqual([r.status, r.location], [307, `https://app.tradeloop.pro${path}`], path)
  }
})

test("the old address moves to the subdomain; everything else is left alone", async () => {
  assert.deepEqual(await visit("https://app.tradeloop.pro/affiliate"), { status: 307, location: "https://affiliate.tradeloop.pro/", rewrite: null })
  assert.equal((await visit("https://app.tradeloop.pro/affiliate/payouts?stripe=return")).location, "https://affiliate.tradeloop.pro/payouts?stripe=return")
  assert.equal((await visit("https://www.tradeloop.pro/affiliate/apply")).location, "https://affiliate.tradeloop.pro/apply")
  assert.equal((await visit("https://tradeloop.pro/affiliate/apply")).location, "https://affiliate.tradeloop.pro/apply")
  // the program terms have a page of their own there; the site's own /terms is a different page and stays on www
  assert.equal((await visit("https://www.tradeloop.pro/affiliate/terms")).location, "https://affiliate.tradeloop.pro/terms")
  assert.deepEqual(await visit("https://www.tradeloop.pro/terms"), { status: 200, location: null, rewrite: null })
  // not the portal: unchanged behaviour
  assert.deepEqual(await visit("https://app.tradeloop.pro/dashboard"), { status: 200, location: null, rewrite: null })
  assert.deepEqual(await visit("https://app.tradeloop.pro/admin/affiliates/payouts"), { status: 200, location: null, rewrite: null })
  assert.equal((await visit("https://app.tradeloop.pro/affiliates")).location, null) // a different word
  assert.equal((await visit("https://help.tradeloop.pro/faq")).rewrite, "https://help.tradeloop.pro/help/faq")
  assert.equal((await visit("https://www.tradeloop.pro/dashboard")).location, "https://app.tradeloop.pro/dashboard")
  // previews and localhost have no subdomains: the portal stays under /affiliate
  for (const host of ["tradeloop-git-x.vercel.app", "localhost:3000"]) {
    const scheme = host.startsWith("localhost") ? "http" : "https"
    assert.deepEqual(await visit(`${scheme}://${host}/affiliate/payouts`), { status: 200, location: null, rewrite: null }, host)
  }
})

test("links: the portal's own address in the app and in emails", async () => {
  const { affiliateHref, portalHref } = await import("@/lib/urls")
  assert.equal(affiliateHref("/affiliate"), "https://affiliate.tradeloop.pro/")
  assert.equal(affiliateHref("/affiliate/payouts"), "https://affiliate.tradeloop.pro/payouts")
  assert.equal(affiliateHref("/affiliate/export/referrals?status=active"), "https://affiliate.tradeloop.pro/export/referrals?status=active")
  assert.equal(affiliateHref("/affiliates-are-great"), "/affiliates-are-great") // not a portal path
  assert.equal(portalHref("/affiliate/earnings"), "https://affiliate.tradeloop.pro/earnings")
  assert.equal(portalHref("/support/12"), "https://app.tradeloop.pro/support/12")

  const { appUrl, renderEmail } = await import("@/lib/emails/layout")
  assert.equal(appUrl("/affiliate/payouts"), "https://affiliate.tradeloop.pro/payouts")
  assert.equal(appUrl("/affiliate"), "https://affiliate.tradeloop.pro/")
  assert.equal(appUrl("/settings"), "https://app.tradeloop.pro/settings")
  const { emailPreviews } = await import("@/lib/emails/affiliate-emails")
  for (const p of emailPreviews()) {
    const { html } = renderEmail(p.doc)
    assert.ok(!html.includes("app.tradeloop.pro/affiliate"), p.id) // no link to the old address
    assert.ok(html.includes('href="https://affiliate.tradeloop.pro/payouts"') && html.includes('href="https://affiliate.tradeloop.pro/support"'), p.id)
    for (const [, href] of html.matchAll(/href="([^"]+)"/g)) assert.ok(/^https:\/\/(app|www|affiliate)\.tradeloop\.pro\/|^https:\/\/tronscan\.org\//.test(href), `${p.id}: ${href}`)
  }
})
