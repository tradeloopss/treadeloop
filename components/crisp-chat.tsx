import Script from "next/script"

// Optional live chat. Off unless NEXT_PUBLIC_CRISP_WEBSITE_ID is set; the
// in-app support desk (/support) works either way.
const websiteId = process.env.NEXT_PUBLIC_CRISP_WEBSITE_ID

// JSON for an inline script, with "<" escaped so a name like "</script>"
// can't end the tag early.
const js = (value: unknown) => JSON.stringify(value).replace(/</g, "\\u003c")

export function CrispChat({ email, name }: { email: string; name: string }) {
  if (!websiteId) return null
  return (
    <Script id="crisp-chat" strategy="afterInteractive">
      {`window.$crisp=[];window.CRISP_WEBSITE_ID=${js(websiteId)};` +
        `$crisp.push(["set","user:email",[${js(email)}]]);$crisp.push(["set","user:nickname",[${js(name)}]]);` +
        `(function(){var s=document.createElement("script");s.src="https://client.crisp.chat/l.js";s.async=1;document.head.appendChild(s)})();`}
    </Script>
  )
}
