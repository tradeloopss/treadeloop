import * as THREE from "three"

// Procedural textures for the loot case — all drawn on canvases at runtime, so
// the case needs no image assets beyond the logo mark.

function canvas(w: number, h: number) {
  const c = document.createElement("canvas")
  c.width = w
  c.height = h
  return { c, ctx: c.getContext("2d")! }
}

function toTexture(c: HTMLCanvasElement, color = true): THREE.CanvasTexture {
  const t = new THREE.CanvasTexture(c)
  t.colorSpace = color ? THREE.SRGBColorSpace : THREE.NoColorSpace
  t.needsUpdate = true
  return t
}

// Small deterministic PRNG so the metal wear pattern is identical everywhere.
function mulberry32(seed: number) {
  let a = seed
  return () => {
    a |= 0
    a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

// Build an alpha-only glow texture from a distance field: alpha = e^-(d/σ)².
function fieldTexture(w: number, h: number, alphaAt: (x: number, y: number) => number): THREE.CanvasTexture {
  const { c, ctx } = canvas(w, h)
  const img = ctx.createImageData(w, h)
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 4
      img.data[i] = 255
      img.data[i + 1] = 255
      img.data[i + 2] = 255
      img.data[i + 3] = Math.round(Math.max(0, Math.min(1, alphaAt(x + 0.5, y + 0.5))) * 255)
    }
  }
  ctx.putImageData(img, 0, 0)
  return toTexture(c)
}

// Signed distance to a rounded rectangle of half-size (bx, by), radius r.
function sdRoundRect(px: number, py: number, bx: number, by: number, r: number) {
  const qx = Math.abs(px) - bx + r
  const qy = Math.abs(py) - by + r
  return Math.hypot(Math.max(qx, 0), Math.max(qy, 0)) + Math.min(Math.max(qx, qy), 0) - r
}

export function radialGlowTexture(size = 256): THREE.CanvasTexture {
  const h = size / 2
  return fieldTexture(size, size, (x, y) => {
    const d = Math.hypot(x - h, y - h) / h
    return Math.exp(-d * d * 4.2) * (1 - Math.min(1, d) ** 6)
  })
}

// Glow around a rectangular ring (the LED frames). `ring` = half-size in px.
export const FRAME_TEX = { w: 256, h: 384, bx: 70, by: 132, r: 16 }
export function frameGlowTexture(): THREE.CanvasTexture {
  const { w, h, bx, by, r } = FRAME_TEX
  return fieldTexture(w, h, (x, y) => {
    const d = sdRoundRect(x - w / 2, y - h / 2, bx, by, r)
    const edge = Math.exp(-((d / 17) ** 2))
    const inner = d < 0 ? 0.22 * Math.exp(-((d / 60) ** 2)) : 0
    const outer = d > 0 ? 0.35 * Math.exp(-((d / 42) ** 2)) : 0
    return Math.max(edge, inner, outer)
  })
}

// Glow around a horizontal bar (LED strips, the lid seam). `len` = half-length in px.
export const BAR_TEX = { w: 512, h: 128, len: 190 }
export function barGlowTexture(): THREE.CanvasTexture {
  const { w, h, len } = BAR_TEX
  return fieldTexture(w, h, (x, y) => {
    const dx = Math.max(0, Math.abs(x - w / 2) - len)
    const d = Math.hypot(dx, y - h / 2)
    return Math.exp(-((d / 13) ** 2)) * 0.95 + 0.35 * Math.exp(-((d / 38) ** 2))
  })
}

// A vertical light ray, bright at the base and fading upward.
export function rayTexture(): THREE.CanvasTexture {
  const w = 64
  const h = 512
  return fieldTexture(w, h, (x, y) => {
    const across = Math.exp(-(((x - w / 2) / 11) ** 2))
    const along = (y / h) ** 1.7
    return across * along
  })
}

// Grey-scale machined-metal wear: soft value noise plus fine scratches. Used as
// roughness + bump map on the shell so it reads as a real, used metal case.
export function noiseTexture(size = 512): THREE.CanvasTexture {
  const { c, ctx } = canvas(size, size)
  const rnd = mulberry32(1337)
  const octaves = [
    { n: 6, w: 0.5 },
    { n: 24, w: 0.3 },
    { n: 96, w: 0.2 },
  ]
  const grids = octaves.map((o) => {
    const g = new Float32Array(o.n * o.n)
    for (let i = 0; i < g.length; i++) g[i] = rnd()
    return g
  })
  const smooth = (t: number) => t * t * (3 - 2 * t)
  const img = ctx.createImageData(size, size)
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      let v = 0
      octaves.forEach((o, k) => {
        const gx = (x / size) * o.n
        const gy = (y / size) * o.n
        const x0 = Math.floor(gx) % o.n
        const y0 = Math.floor(gy) % o.n
        const x1 = (x0 + 1) % o.n
        const y1 = (y0 + 1) % o.n
        const fx = smooth(gx - Math.floor(gx))
        const fy = smooth(gy - Math.floor(gy))
        const g = grids[k]
        const a = g[y0 * o.n + x0] + (g[y0 * o.n + x1] - g[y0 * o.n + x0]) * fx
        const b = g[y1 * o.n + x0] + (g[y1 * o.n + x1] - g[y1 * o.n + x0]) * fx
        v += (a + (b - a) * fy) * o.w
      })
      const val = Math.round((0.78 + (v - 0.5) * 0.42) * 255)
      const i = (y * size + x) * 4
      img.data[i] = img.data[i + 1] = img.data[i + 2] = val
      img.data[i + 3] = 255
    }
  }
  ctx.putImageData(img, 0, 0)
  // Fine scratches — a few light (rougher) and dark (polished) strokes.
  ctx.lineCap = "round"
  for (let i = 0; i < 140; i++) {
    const x = rnd() * size
    const y = rnd() * size
    const len = 8 + rnd() * 46
    const ang = (rnd() - 0.5) * 0.9 + (rnd() < 0.5 ? 0 : Math.PI / 2)
    ctx.strokeStyle = rnd() < 0.6 ? `rgba(255,255,255,${0.12 + rnd() * 0.2})` : `rgba(0,0,0,${0.1 + rnd() * 0.18})`
    ctx.lineWidth = 0.6 + rnd() * 1.2
    ctx.beginPath()
    ctx.moveTo(x, y)
    ctx.lineTo(x + Math.cos(ang) * len, y + Math.sin(ang) * len)
    ctx.stroke()
  }
  const t = toTexture(c, false)
  t.wrapS = t.wrapT = THREE.RepeatWrapping
  t.repeat.set(0.75, 0.75)
  return t
}

// The front panel artwork: the TradeLoop hex badge with "tradeloop" and ".pro"
// underneath, glowing softly — as on the reference case. Redrawn once the logo
// image has loaded; `ready` resolves then.
export function logoTexture(logoSrc?: string): { texture: THREE.CanvasTexture; ready: Promise<void> } {
  const W = 1024
  const H = 640
  const { c, ctx } = canvas(W, H)
  const texture = toTexture(c)
  texture.anisotropy = 4
  const font = "'Poppins','Montserrat','Segoe UI','Helvetica Neue',Arial,sans-serif"

  const draw = (img?: HTMLImageElement) => {
    ctx.clearRect(0, 0, W, H)
    const cx = W / 2
    const by = 222 // badge centre
    // Soft purple bloom behind the badge.
    const bloom = ctx.createRadialGradient(cx, by, 10, cx, by, 300)
    bloom.addColorStop(0, "rgba(150,100,255,0.55)")
    bloom.addColorStop(0.5, "rgba(120,80,240,0.18)")
    bloom.addColorStop(1, "rgba(120,80,240,0)")
    ctx.fillStyle = bloom
    ctx.fillRect(0, 0, W, H)

    const size = 300
    ctx.save()
    ctx.shadowColor = "rgba(170,120,255,0.95)"
    ctx.shadowBlur = 55
    if (img) {
      ctx.imageSmoothingEnabled = true
      ctx.imageSmoothingQuality = "high"
      ctx.drawImage(img, cx - size / 2, by - size / 2, size, size)
    } else {
      // Fallback badge: a rounded purple hexagon with "TL".
      ctx.beginPath()
      for (let i = 0; i < 6; i++) {
        const a = Math.PI / 6 + (i * Math.PI) / 3
        const px = cx + Math.cos(a) * (size / 2)
        const py = by + Math.sin(a) * (size / 2)
        if (i === 0) ctx.moveTo(px, py)
        else ctx.lineTo(px, py)
      }
      ctx.closePath()
      ctx.fillStyle = "#7c5cff"
      ctx.fill()
      ctx.shadowBlur = 0
      ctx.fillStyle = "#fff"
      ctx.font = `800 120px ${font}`
      ctx.textAlign = "center"
      ctx.textBaseline = "middle"
      ctx.fillText("TL", cx, by)
    }
    ctx.restore()

    // Wordmark.
    ctx.save()
    ctx.font = `700 124px ${font}`
    ctx.textAlign = "center"
    ctx.textBaseline = "alphabetic"
    ctx.shadowColor = "rgba(200,175,255,0.6)"
    ctx.shadowBlur = 22
    ctx.fillStyle = "#f3efff"
    ctx.fillText("tradeloop", cx, 500)
    const tw = ctx.measureText("tradeloop").width
    ctx.font = `700 64px ${font}`
    ctx.textAlign = "right"
    ctx.shadowColor = "rgba(167,139,250,0.85)"
    ctx.fillStyle = "#a98bff"
    ctx.fillText(".pro", cx + tw / 2 - 4, 572)
    ctx.restore()
    texture.needsUpdate = true
  }

  draw()
  const ready = logoSrc
    ? new Promise<void>((resolve) => {
        const img = new Image()
        img.onload = () => {
          draw(img)
          resolve()
        }
        img.onerror = () => resolve()
        img.src = logoSrc
      })
    : Promise.resolve()
  return { texture, ready }
}
