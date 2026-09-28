import { NextResponse, type NextRequest } from "next/server"

// Host-based routing for the subdomains. This is a NO-OP on the apex domain,
// www, Vercel previews and localhost (the app + marketing keep working exactly
// as before) — it only does anything once real `help.` / `app.` subdomains are
// pointed at this deployment.
//
//   help.<domain>  → the /help center (clean URLs: help.tradeloop.pro/faq)
//   app.<domain>   → the app; the root sends you to the dashboard
//   <domain>/www   → unchanged (marketing site + app together)
export const config = {
  // Skip API routes, Next internals and static files.
  matcher: ["/((?!api/|_next/|_vercel/|favicon.ico|.*\\.(?:png|jpg|jpeg|gif|svg|ico|webp|txt|xml|webmanifest)).*)"],
}

export function middleware(req: NextRequest) {
  const host = (req.headers.get("host") || "").toLowerCase()
  const sub = host.split(":")[0].split(".")[0]
  const url = req.nextUrl

  if (sub === "help") {
    // Already under /help? serve as-is. Otherwise prefix so the subdomain's
    // clean paths map onto the /help routes.
    if (url.pathname === "/help" || url.pathname.startsWith("/help/")) return NextResponse.next()
    const to = url.clone()
    to.pathname = url.pathname === "/" ? "/help" : `/help${url.pathname}`
    return NextResponse.rewrite(to)
  }

  if (sub === "app") {
    // The app subdomain shouldn't show the marketing home or the help center.
    if (url.pathname === "/" || url.pathname === "/help" || url.pathname.startsWith("/help/")) {
      const to = url.clone()
      to.pathname = "/dashboard"
      return NextResponse.redirect(to)
    }
    return NextResponse.next()
  }

  return NextResponse.next()
}
