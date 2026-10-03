"use client"

import { useEffect, useState } from "react"

// "Good morning, Eslam! 👋" — by the visitor's own clock, so it is decided in
// the browser (the server doesn't know their time zone).
export function Greeting({ name }: { name: string }) {
  const [part, setPart] = useState<string | null>(null)
  useEffect(() => {
    const h = new Date().getHours()
    setPart(h < 5 ? "Good evening" : h < 12 ? "Good morning" : h < 18 ? "Good afternoon" : "Good evening")
  }, [])
  return (
    <>
      {part ?? "Hello"}, {name}! <span aria-hidden>👋</span>
    </>
  )
}
