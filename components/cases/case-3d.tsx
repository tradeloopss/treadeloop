"use client"

import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from "react"
import { cn } from "@/lib/utils"
import { LOGO_MARK_DATA_URI } from "@/lib/brand-logo"
import type { CaseFraming, CaseSceneController, CaseTone } from "@/lib/cases/case3d/scene"

// The 3D TradeLoop loot case. Loads three.js lazily (its own chunk, only where
// a case is shown) and renders into a transparent canvas. Users can't drag or
// tilt it — it floats and sways gently on its own; hover brightens it, and a
// click/tap or Enter/Space activates it. Rendering pauses off-screen, in hidden
// tabs and while `paused`. Without WebGL it falls back to a static render.

export type Case3DHandle = {
  open(opts?: { cinematic?: boolean }): void
  close(): void
  setState(state: "open" | "closed"): void
}

type Props = {
  className?: string
  initial?: "closed" | "open"
  framing?: CaseFraming
  tone?: CaseTone
  /** brighten on hover */
  interactive?: boolean
  /** additive neon glow regardless of the page theme (for dark stages) */
  forceDark?: boolean
  /** what a click/tap does: call onActivate, toggle open/closed, or nothing */
  clickMode?: "activate" | "toggle" | "none"
  /** stop rendering (e.g. while a full-screen overlay covers it) */
  paused?: boolean
  onActivate?: () => void
  onBurst?: () => void
  onOpened?: () => void
  onClosed?: () => void
  ariaLabel?: string
}

type Command = { kind: "open"; cinematic: boolean } | { kind: "close" } | { kind: "state"; state: "open" | "closed" }

export const Case3D = forwardRef<Case3DHandle, Props>(function Case3D(
  { className, initial = "closed", framing = "hero", tone = "brand", interactive = true, forceDark = false, clickMode = "none", paused = false, onActivate, onBurst, onOpened, onClosed, ariaLabel },
  ref,
) {
  const wrapRef = useRef<HTMLDivElement>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const ctl = useRef<CaseSceneController | null>(null)
  const pending = useRef<Command | null>(null)
  const [ready, setReady] = useState(false)
  const [failed, setFailed] = useState(false)
  const fallbackState = useRef<"open" | "closed">(initial)
  const [fallbackOpen, setFallbackOpen] = useState(initial === "open")

  // Latest props for the scene's callbacks and the pointer handlers.
  const live = useRef({ onActivate, onBurst, onOpened, onClosed, clickMode, interactive, paused })
  live.current = { onActivate, onBurst, onOpened, onClosed, clickMode, interactive, paused }
  const updateVisibility = useRef<() => void>(() => {})

  const run = (cmd: Command) => {
    const c = ctl.current
    if (!c) {
      if (failed) runFallback(cmd)
      else pending.current = cmd
      return
    }
    if (cmd.kind === "open") c.open({ cinematic: cmd.cinematic })
    else if (cmd.kind === "close") c.close()
    else c.setState(cmd.state)
  }

  // Without WebGL there's no animation, but callers still get their callbacks.
  const runFallback = (cmd: Command) => {
    if (cmd.kind === "state") {
      fallbackState.current = cmd.state
      setFallbackOpen(cmd.state === "open")
    } else if (cmd.kind === "open" && fallbackState.current === "closed") {
      fallbackState.current = "open"
      setFallbackOpen(true)
      setTimeout(() => live.current.onBurst?.(), 250)
      setTimeout(() => live.current.onOpened?.(), 700)
    } else if (cmd.kind === "close" && fallbackState.current === "open") {
      fallbackState.current = "closed"
      setFallbackOpen(false)
      setTimeout(() => live.current.onClosed?.(), 300)
    }
  }

  useImperativeHandle(ref, () => ({
    open: (opts) => run({ kind: "open", cinematic: opts?.cinematic ?? true }),
    close: () => run({ kind: "close" }),
    setState: (state) => run({ kind: "state", state }),
  }))

  // Create the scene once.
  useEffect(() => {
    let cancelled = false
    let cleanup: (() => void) | undefined
    const canvas = canvasRef.current
    const wrap = wrapRef.current
    if (!canvas || !wrap) return

    import("@/lib/cases/case3d/scene")
      .then(({ createCaseScene }) => {
        if (cancelled) return
        const reduceMq = window.matchMedia("(prefers-reduced-motion: reduce)")
        const isDark = () => forceDark || document.documentElement.classList.contains("dark")
        let controller: CaseSceneController
        try {
          controller = createCaseScene(canvas, {
            initial,
            framing,
            tone,
            glow: isDark() ? "additive" : "normal",
            reducedMotion: reduceMq.matches,
            logoSrc: LOGO_MARK_DATA_URI,
            onBurst: () => live.current.onBurst?.(),
            onOpened: () => live.current.onOpened?.(),
            onClosed: () => live.current.onClosed?.(),
          })
        } catch {
          setFailed(true)
          if (pending.current) runFallback(pending.current)
          pending.current = null
          return
        }
        ctl.current = controller

        const size = () => {
          const r = wrap.getBoundingClientRect()
          const dpr = Math.min(window.devicePixelRatio || 1, r.width < 640 ? 1.75 : 2)
          controller.resize(r.width, r.height, dpr)
        }
        size()
        const ro = new ResizeObserver(size)
        ro.observe(wrap)

        let onScreen = true
        const setVis = () => controller.setVisible(onScreen && !live.current.paused && document.visibilityState === "visible")
        updateVisibility.current = setVis
        const io = new IntersectionObserver((entries) => {
          onScreen = entries.some((e) => e.isIntersecting)
          setVis()
        })
        io.observe(wrap)
        document.addEventListener("visibilitychange", setVis)

        const onReduce = () => controller.setReducedMotion(reduceMq.matches)
        reduceMq.addEventListener("change", onReduce)
        const mo = new MutationObserver(() => controller.setGlowBlend(isDark() ? "additive" : "normal"))
        mo.observe(document.documentElement, { attributes: true, attributeFilter: ["class"] })

        controller.ready.then(() => {
          if (cancelled) return
          setReady(true)
          if (pending.current) {
            const cmd = pending.current
            pending.current = null
            run(cmd)
          }
        })

        cleanup = () => {
          ro.disconnect()
          io.disconnect()
          mo.disconnect()
          document.removeEventListener("visibilitychange", setVis)
          reduceMq.removeEventListener("change", onReduce)
          controller.dispose()
          ctl.current = null
        }
      })
      .catch(() => {
        if (!cancelled) setFailed(true)
      })

    return () => {
      cancelled = true
      cleanup?.()
    }
    // The scene is created once; later prop changes are applied below.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    ctl.current?.setTone(tone)
  }, [tone])

  useEffect(() => {
    updateVisibility.current()
  }, [paused])

  // ---- click + keyboard. The case can't be dragged or tilted by the user —
  // it only floats and sways gently on its own; hover just brightens it.
  const activate = () => {
    const mode = live.current.clickMode
    if (mode === "activate") live.current.onActivate?.()
    else if (mode === "toggle") {
      const c = ctl.current
      if (c) c.toggle()
      else if (failed) runFallback({ kind: fallbackState.current === "open" ? "close" : "open", cinematic: false } as Command)
    }
  }

  const clickable = clickMode !== "none"

  return (
    <div
      ref={wrapRef}
      className={cn("relative select-none outline-none focus-visible:rounded-2xl focus-visible:ring-2 focus-visible:ring-violet-400/60", clickable && "cursor-pointer", className)}
      role={clickable ? "button" : "img"}
      tabIndex={clickable ? 0 : undefined}
      aria-label={ariaLabel ?? "TradeLoop case"}
      onClick={clickable ? activate : undefined}
      onPointerEnter={() => live.current.interactive && ctl.current?.setHover(true)}
      onPointerLeave={() => ctl.current?.setHover(false)}
      onKeyDown={(e) => {
        if (clickable && (e.key === "Enter" || e.key === " ")) {
          e.preventDefault()
          activate()
        }
      }}
    >
      {/* Soft glow while three.js loads, so there's no empty hole. */}
      {!ready && !failed && <div className="pointer-events-none absolute inset-[18%] animate-pulse rounded-[40%] bg-[radial-gradient(circle,rgba(139,92,246,0.35),transparent_68%)] blur-2xl" />}
      <canvas ref={canvasRef} className={cn("absolute inset-0 size-full transition-opacity duration-500", ready ? "opacity-100" : "opacity-0")} />
      {failed && (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src="/cases/case-closed.png"
          alt=""
          draggable={false}
          className={cn("absolute inset-0 size-full object-contain transition-[filter] duration-500", fallbackOpen && "brightness-125 drop-shadow-[0_0_40px_rgba(168,85,247,0.6)]")}
          style={{ WebkitMaskImage: "radial-gradient(ellipse 90% 94% at 50% 47%, #000 68%, transparent 93%)", maskImage: "radial-gradient(ellipse 90% 94% at 50% 47%, #000 68%, transparent 93%)" }}
        />
      )}
    </div>
  )
})
