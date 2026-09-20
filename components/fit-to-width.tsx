"use client"

import { useEffect, useRef, useState } from "react"

// Scales a fixed-width design down to fit the available width (never up), so
// a card built at a set pixel width — like the share certificates — keeps its
// exact layout on a phone instead of reflowing or overflowing. The child
// still renders at its natural size, so html-to-image captures it at full
// resolution regardless of how small it's shown.
export function FitToWidth({
  width,
  className,
  children,
}: {
  width: number
  className?: string
  children: React.ReactNode
}) {
  const measureRef = useRef<HTMLDivElement>(null)
  const innerRef = useRef<HTMLDivElement>(null)
  const [scale, setScale] = useState(1)
  const [box, setBox] = useState<{ w: number; h: number | undefined }>({ w: width, h: undefined })

  useEffect(() => {
    const measure = measureRef.current
    const inner = innerRef.current
    if (!measure || !inner) return
    const update = () => {
      const available = measure.clientWidth
      const s = Math.min(1, available / width)
      setScale(s)
      setBox({ w: width * s, h: inner.offsetHeight * s })
    }
    update()
    const ro = new ResizeObserver(update)
    ro.observe(measure)
    ro.observe(inner)
    return () => ro.disconnect()
  }, [width])

  return (
    // minWidth:0 lets this shrink below the child's natural width when it sits
    // in a CSS grid or flex track (e.g. a dialog), so the available width it
    // measures is the container's, not the child's own fixed width.
    <div ref={measureRef} className={className} style={{ width: "100%", minWidth: 0, maxWidth: "100%" }}>
      <div style={{ width: box.w, height: box.h, marginInline: "auto", position: "relative" }}>
        <div ref={innerRef} style={{ width, position: "absolute", insetInlineStart: 0, top: 0, transform: `scale(${scale})`, transformOrigin: "top left" }}>
          {children}
        </div>
      </div>
    </div>
  )
}
