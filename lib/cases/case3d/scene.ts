import * as THREE from "three"
import { octagonShape, ringShape, polygonShape, prismY, plateZ, type Oct } from "./geometry"
import {
  BAR_TEX,
  FRAME_TEX,
  barGlowTexture,
  frameGlowTexture,
  iconTextures,
  logoTexture,
  noiseTexture,
  radialGlowTexture,
  rayTexture,
} from "./textures"

// The TradeLoop loot case — a procedurally modelled, real-time 3D case with a
// hinged lid, releasing latches, LED lighting and a cinematic open/close.
// Framework-agnostic: the React wrapper (components/cases/case-3d.tsx) owns the
// canvas lifecycle; this module owns the scene, the animation and the render.
// The reward itself is NEVER decided here — the case only reveals.

export type CaseTone = "brand" | "legendary" | "epic" | "rare" | "common"
export type CaseMode = "closed" | "opening" | "open" | "closing"
export type CaseFraming = "hero" | "stage" | "compact"
export type GlowBlend = "additive" | "normal"

export interface CaseSceneOptions {
  initial?: "closed" | "open"
  framing?: CaseFraming
  tone?: CaseTone
  glow?: GlowBlend
  reducedMotion?: boolean
  idleSway?: boolean
  logoSrc?: string
  onBurst?: () => void
  onOpened?: () => void
  onClosed?: () => void
}

export interface CaseSceneController {
  readonly ready: Promise<void>
  open(opts?: { cinematic?: boolean }): boolean
  close(): boolean
  toggle(): boolean
  setState(state: "closed" | "open"): void
  mode(): CaseMode
  busy(): boolean
  setTone(tone: CaseTone): void
  setGlowBlend(blend: GlowBlend): void
  setReducedMotion(reduced: boolean): void
  setHover(hover: boolean): void
  setPointer(x: number, y: number): void
  dragBy(dx: number, dy: number): void
  endDrag(): void
  setVisible(visible: boolean): void
  resize(width: number, height: number, dpr: number): void
  renderAt(mode: CaseMode, t: number, opts?: { cinematic?: boolean; yaw?: number; pitch?: number; hover?: number }): void
  dispose(): void
}

// ------------------------------------------------------------------ geometry

const W = 3.2 // width
const D = 1.9 // depth
const C = 0.5 // vertical corner chamfer
const HB = 1.3 // base height
const HL = 0.64 // lid height
const T = 0.13 // wall thickness
const GAP = 0.014 // lid/base seam
const LATCH_X = 0.93
const LID_OPEN = -1.85 // ≈106°
// Draw latches are hinged on the base: released, they swing out and hang open
// on the front (≈140°); closing, they swing back up and clamp over the lid.
const LATCH_OPEN = 2.45
const OUTER: Oct = [W, D, C]
// Inner chamfer chosen so the wall is exactly T thick on the diagonals too —
// a thinner diagonal makes the bevelled cap self-intersect and the triangulator
// silently fills the opening.
const INNER: Oct = [W - 2 * T, D - 2 * T, C - T * (2 - Math.SQRT2)]

const TONES: Record<CaseTone, { a: number; b: number }> = {
  brand: { a: 0xa855f7, b: 0x7c9cff },
  legendary: { a: 0xfbbf24, b: 0xc084fc },
  epic: { a: 0xe879f9, b: 0xa855f7 },
  rare: { a: 0x38bdf8, b: 0x8b5cf6 },
  common: { a: 0x8b5cf6, b: 0x60a5fa },
}

const FRAMING: Record<CaseFraming, { fov: number; elev: number; halfW: number; closed: [number, number]; open: [number, number] }> = {
  // [centre y, half height]
  hero: { fov: 30, elev: 0.2, halfW: 2.35, closed: [1.02, 1.45], open: [1.62, 2.12] },
  stage: { fov: 30, elev: 0.22, halfW: 2.3, closed: [1.06, 1.5], open: [1.7, 2.18] },
  compact: { fov: 30, elev: 0.2, halfW: 2.15, closed: [1.0, 1.32], open: [1.6, 2.0] },
}

// -------------------------------------------------------------------- easing

const clamp01 = (v: number) => (v < 0 ? 0 : v > 1 ? 1 : v)
const seg = (t: number, a: number, b: number) => clamp01((t - a) / (b - a))
const lerp = (a: number, b: number, t: number) => a + (b - a) * t
const easeOutCubic = (x: number) => 1 - (1 - x) ** 3
const easeInCubic = (x: number) => x * x * x
const easeInQuad = (x: number) => x * x
const easeInOutCubic = (x: number) => (x < 0.5 ? 4 * x * x * x : 1 - (-2 * x + 2) ** 3 / 2)
const easeOutBack = (x: number, s = 1.70158) => 1 + (s + 1) * (x - 1) ** 3 + s * (x - 1) ** 2
const bell = (x: number) => Math.sin(Math.PI * clamp01(x))

// --------------------------------------------------------------- timeline

interface Params {
  lid: number
  latch: number
  charge: number
  shake: number
  approach: number
  latchFlash: number
  interior: number
  beam: number
  burst: number
  rays: number
  thud: number
}

const CLOSED: Params = { lid: 0, latch: 0, charge: 0, shake: 0, approach: 0, latchFlash: 0, interior: 0, beam: 0, burst: 0, rays: 0, thud: 0 }
const OPEN: Params = { lid: LID_OPEN, latch: LATCH_OPEN, charge: 0.35, shake: 0, approach: 0, latchFlash: 0, interior: 1, beam: 0.7, burst: 0, rays: 0.35, thud: 0 }

// A released latch falls open with a little swing past its resting angle.
const latchRelease = (t: number, a: number, b: number) => LATCH_OPEN * easeOutBack(seg(t, a, b), 1.6)

// Opening. Cinematic: lock (0–.45) → charge (.4–1.1) → shake (1.1–1.8) →
// unlock (1.8–2.15) → lid (2.1–2.95) → burst (2.3) → settle (3.6).
const OPEN_BURST = { cinematic: 2.3, quick: 0.35, reduced: 0.05 }
const OPEN_REVEAL = { cinematic: 3.0, quick: 1.05, reduced: 0.4 }
const OPEN_DONE = { cinematic: 3.6, quick: 1.2, reduced: 0.4 }

function openParams(t: number, kind: "cinematic" | "quick" | "reduced"): Params {
  if (kind === "reduced") {
    const k = seg(t, 0, 0.35)
    return { ...CLOSED, lid: LID_OPEN * k, latch: LATCH_OPEN * k, charge: 0.35 * k, interior: k, beam: 0.7 * k, rays: 0.35 * k }
  }
  if (kind === "quick") {
    const interior = easeOutCubic(seg(t, 0.3, 0.9))
    const burst = 0.55 * bell(seg(t, 0.3, 0.95))
    return {
      ...CLOSED,
      latch: latchRelease(t, 0, 0.34),
      lid: LID_OPEN * easeOutBack(seg(t, 0.18, 0.95), 1.05),
      interior,
      beam: 0.7 * easeOutCubic(seg(t, 0.35, 1.05)),
      burst,
      rays: Math.max(burst, 0.35 * interior),
      charge: 0.35 * interior + 0.45 * bell(seg(t, 0, 0.5)),
      latchFlash: bell(seg(t, 0, 0.32)),
    }
  }
  const approach = t < 2 ? easeOutCubic(seg(t, 0, 0.45)) : 1 - easeInOutCubic(seg(t, 2, 3.4))
  const chargeUp = easeInQuad(seg(t, 0.4, 1.1))
  const charge = chargeUp * (1 - 0.65 * easeInOutCubic(seg(t, 2.3, 3.2)))
  const burst = t < 2.3 ? 0 : t < 2.42 ? easeOutCubic(seg(t, 2.3, 2.42)) : 1 - easeInOutCubic(seg(t, 2.42, 3.4))
  const interior = easeOutCubic(seg(t, 2.2, 2.8))
  return {
    lid: LID_OPEN * easeOutBack(seg(t, 2.1, 2.95), 1.1),
    latch: latchRelease(t, 1.8, 2.2),
    charge,
    shake: bell(seg(t, 1.1, 1.8)) + 0.3 * bell(seg(t, 0.12, 0.45)),
    approach,
    latchFlash: 0.8 * bell(seg(t, 0.12, 0.5)) + bell(seg(t, 1.75, 2.15)),
    interior,
    beam: easeOutCubic(seg(t, 2.3, 2.7)) * (1 - 0.3 * easeInOutCubic(seg(t, 2.8, 3.6))),
    burst,
    rays: Math.max(burst, 0.35 * interior),
    thud: 0,
  }
}

// Closing: the lid swings down under its weight, lands with a thud and a small
// rebound, the seam flashes, then the latches snap shut.
const CLOSE_IMPACT = 0.7
const CLOSE_DONE = { normal: 1.3, reduced: 0.4 }

function closeParams(t: number, reduced: boolean): Params {
  if (reduced) {
    const k = 1 - seg(t, 0, 0.35)
    return { ...CLOSED, lid: LID_OPEN * k, latch: LATCH_OPEN * k, charge: 0.35 * k, interior: k, beam: 0.7 * k, rays: 0.35 * k }
  }
  const rb = seg(t, CLOSE_IMPACT, 1.05)
  // After the lid lands, the latches swing up over the keepers and snap shut.
  const latch = LATCH_OPEN * (1 - easeOutBack(seg(t, 0.78, 1.12), 1.1))
  return {
    lid: LID_OPEN * (1 - easeInCubic(seg(t, 0, CLOSE_IMPACT))) - 0.075 * Math.sin(Math.PI * rb) * (1 - rb),
    latch,
    charge: 0.35 * (1 - seg(t, 0, 0.6)) + 0.55 * bell(seg(t, CLOSE_IMPACT, 1.0)),
    shake: 0.55 * bell(seg(t, CLOSE_IMPACT, 0.9)),
    approach: 0,
    latchFlash: 0.6 * bell(seg(t, 0.92, 1.2)),
    interior: 1 - easeInOutCubic(seg(t, 0.1, 0.75)),
    beam: 0.7 * (1 - easeOutCubic(seg(t, 0, 0.35))),
    burst: 0,
    rays: 0.35 * (1 - seg(t, 0, 0.3)),
    thud: bell(seg(t, CLOSE_IMPACT - 0.02, 0.9)),
  }
}

// ------------------------------------------------------------- particles

const MAX_PARTICLES = 320

class Particles {
  readonly points: THREE.Points
  readonly material: THREE.ShaderMaterial
  private pos = new Float32Array(MAX_PARTICLES * 3)
  private vel = new Float32Array(MAX_PARTICLES * 3)
  private life = new Float32Array(MAX_PARTICLES)
  private max = new Float32Array(MAX_PARTICLES)
  private size = new Float32Array(MAX_PARTICLES)
  private alpha = new Float32Array(MAX_PARTICLES)
  private col = new Float32Array(MAX_PARTICLES * 3)
  private cursor = 0
  private geo = new THREE.BufferGeometry()

  constructor() {
    this.geo.setAttribute("position", new THREE.BufferAttribute(this.pos, 3))
    this.geo.setAttribute("aSize", new THREE.BufferAttribute(this.size, 1))
    this.geo.setAttribute("aAlpha", new THREE.BufferAttribute(this.alpha, 1))
    this.geo.setAttribute("aColor", new THREE.BufferAttribute(this.col, 3))
    this.material = new THREE.ShaderMaterial({
      uniforms: { uScale: { value: 300 } },
      vertexShader: /* glsl */ `
        attribute float aSize; attribute float aAlpha; attribute vec3 aColor;
        uniform float uScale;
        varying float vAlpha; varying vec3 vColor;
        void main() {
          vec4 mv = modelViewMatrix * vec4(position, 1.0);
          gl_Position = projectionMatrix * mv;
          gl_PointSize = aSize * uScale / max(0.1, -mv.z);
          vAlpha = aAlpha; vColor = aColor;
        }`,
      fragmentShader: /* glsl */ `
        varying float vAlpha; varying vec3 vColor;
        void main() {
          float d = length(gl_PointCoord - 0.5);
          float a = smoothstep(0.5, 0.0, d);
          gl_FragColor = vec4(vColor, a * a * vAlpha);
        }`,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    })
    this.points = new THREE.Points(this.geo, this.material)
    this.points.frustumCulled = false
  }

  reset() {
    this.life.fill(0)
    this.alpha.fill(0)
  }

  spawn(x: number, y: number, z: number, vx: number, vy: number, vz: number, life: number, size: number, color: THREE.Color) {
    const i = this.cursor
    this.cursor = (this.cursor + 1) % MAX_PARTICLES
    this.pos.set([x, y, z], i * 3)
    this.vel.set([vx, vy, vz], i * 3)
    this.life[i] = life
    this.max[i] = life
    this.size[i] = size
    this.col.set([color.r, color.g, color.b], i * 3)
  }

  update(dt: number, drag: number) {
    const k = Math.exp(-drag * dt)
    for (let i = 0; i < MAX_PARTICLES; i++) {
      if (this.life[i] <= 0) {
        this.alpha[i] = 0
        continue
      }
      this.life[i] -= dt
      const j = i * 3
      this.vel[j] *= k
      this.vel[j + 1] = this.vel[j + 1] * k + 0.15 * dt
      this.vel[j + 2] *= k
      this.pos[j] += this.vel[j] * dt
      this.pos[j + 1] += this.vel[j + 1] * dt
      this.pos[j + 2] += this.vel[j + 2] * dt
      const age = 1 - this.life[i] / this.max[i]
      this.alpha[i] = Math.max(0, Math.min(1, age / 0.12) * (1 - age) ** 1.3)
    }
    for (const name of ["position", "aAlpha"]) (this.geo.getAttribute(name) as THREE.BufferAttribute).needsUpdate = true
    ;(this.geo.getAttribute("aSize") as THREE.BufferAttribute).needsUpdate = true
    ;(this.geo.getAttribute("aColor") as THREE.BufferAttribute).needsUpdate = true
  }

  dispose() {
    this.geo.dispose()
    this.material.dispose()
  }
}

// --------------------------------------------------------------- the scene

export function createCaseScene(canvas: HTMLCanvasElement, options: CaseSceneOptions = {}): CaseSceneController {
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true, powerPreference: "high-performance", preserveDrawingBuffer: false })
  renderer.setClearColor(0x000000, 0)
  renderer.outputColorSpace = THREE.SRGBColorSpace
  renderer.toneMapping = THREE.ACESFilmicToneMapping
  renderer.toneMappingExposure = 1.08

  const scene = new THREE.Scene()
  const camera = new THREE.PerspectiveCamera(30, 1, 0.1, 100)

  const disposables: { dispose(): void }[] = []
  const track = <T extends { dispose(): void }>(x: T) => {
    disposables.push(x)
    return x
  }

  // Environment: a dark studio with purple/blue light panels, so the metal
  // picks up the neon reflections of the reference instead of a grey room.
  {
    const env = new THREE.Scene()
    env.background = new THREE.Color(0x05050c)
    const box = new THREE.BoxGeometry(1, 1, 1)
    const panel = (color: number, intensity: number, p: [number, number, number], s: [number, number, number]) => {
      const m = new THREE.Mesh(box, new THREE.MeshBasicMaterial({ color: new THREE.Color(color).multiplyScalar(intensity) }))
      m.position.set(...p)
      m.scale.set(...s)
      env.add(m)
    }
    panel(0xc4caff, 3.4, [0, 7, 3], [7, 0.2, 3])
    panel(0xe6e8ff, 2.2, [-2.5, 3.5, 6.5], [3, 1.4, 0.2])
    panel(0x8b5cf6, 5, [-7, 1.5, 1], [0.2, 4, 4])
    panel(0x8b5cf6, 5, [7, 1.5, 1], [0.2, 4, 4])
    panel(0x3b5bff, 4, [0, 4, -7], [7, 2.5, 0.2])
    panel(0x6f6fb0, 1.2, [0, 1.2, 8], [9, 3, 0.2])
    panel(0x4c1d95, 1.2, [0, -4, 0], [9, 0.2, 9])
    const pmrem = new THREE.PMREMGenerator(renderer)
    const rt = pmrem.fromScene(env, 0.04)
    scene.environment = rt.texture
    scene.environmentIntensity = 1
    disposables.push(rt)
    pmrem.dispose()
    box.dispose()
    env.traverse((o) => {
      if (o instanceof THREE.Mesh) (o.material as THREE.Material).dispose()
    })
  }

  // ---- textures
  const noise = track(noiseTexture())
  const radial = track(radialGlowTexture())
  const frameGlow = track(frameGlowTexture())
  const barGlow = track(barGlowTexture())
  const rayTex = track(rayTexture())
  const logo = logoTexture(options.logoSrc)
  track(logo.texture)
  const icons = iconTextures().map((t) => track(t))

  // ---- materials
  const M = {
    body: new THREE.MeshPhysicalMaterial({ color: 0x131535, metalness: 0.8, roughness: 0.46, roughnessMap: noise, bumpMap: noise, bumpScale: 0.35, clearcoat: 0.35, clearcoatRoughness: 0.42 }),
    armor: new THREE.MeshPhysicalMaterial({ color: 0x1b1e47, metalness: 0.86, roughness: 0.34, roughnessMap: noise, bumpMap: noise, bumpScale: 0.25, clearcoat: 0.6, clearcoatRoughness: 0.26 }),
    inset: new THREE.MeshStandardMaterial({ color: 0x07081a, metalness: 0.55, roughness: 0.62, envMapIntensity: 0.6 }),
    ledPanel: new THREE.MeshStandardMaterial({ color: 0x0b0a24, metalness: 0.4, roughness: 0.5, emissive: new THREE.Color(0x6d28d9), emissiveIntensity: 0.2 }),
    trim: new THREE.MeshPhysicalMaterial({ color: 0x2c3066, metalness: 0.92, roughness: 0.24, clearcoat: 0.6, envMapIntensity: 1.2 }),
    metal: new THREE.MeshPhysicalMaterial({ color: 0xdadcea, metalness: 0.92, roughness: 0.26, clearcoat: 1, clearcoatRoughness: 0.12, envMapIntensity: 2.4, emissive: new THREE.Color(0x9b6bff), emissiveIntensity: 0 }),
    bolt: new THREE.MeshPhysicalMaterial({ color: 0x9aa0c4, metalness: 1, roughness: 0.3, envMapIntensity: 1.8 }),
    interior: new THREE.MeshStandardMaterial({ color: 0x0b0919, metalness: 0.2, roughness: 0.92, emissive: new THREE.Color(0x4c1d95), emissiveIntensity: 0 }),
    liner: new THREE.MeshStandardMaterial({ color: 0x140d2e, metalness: 0.1, roughness: 0.88, emissive: new THREE.Color(0x4c1d95), emissiveIntensity: 0 }),
    led: new THREE.MeshBasicMaterial({ color: 0xc28bff, toneMapped: false }),
    seam: new THREE.MeshBasicMaterial({ color: 0xcaa8ff, transparent: true, opacity: 0.2, toneMapped: false, depthWrite: false }),
    lidRing: new THREE.MeshBasicMaterial({ color: 0xc28bff, transparent: true, opacity: 0, toneMapped: false, depthWrite: false, side: THREE.DoubleSide }),
    core: new THREE.MeshBasicMaterial({ color: 0xc084fc, transparent: true, opacity: 0, toneMapped: false }),
    logo: new THREE.MeshBasicMaterial({ map: logo.texture, transparent: true, toneMapped: false, depthWrite: false }),
  }
  Object.values(M).forEach((m) => track(m))

  // Glow sprites: tracked so their blending can follow the page theme.
  type Glow = { mat: THREE.MeshBasicMaterial; color: THREE.Color }
  const glows: Glow[] = []
  const glowMat = (map: THREE.Texture, color: number) => {
    const mat = new THREE.MeshBasicMaterial({ map, color, transparent: true, opacity: 0, depthWrite: false, toneMapped: false })
    glows.push({ mat, color: new THREE.Color(color) })
    return track(mat)
  }

  const geo = <G extends THREE.BufferGeometry>(g: G) => track(g)
  const mesh = (g: THREE.BufferGeometry, m: THREE.Material, parent: THREE.Object3D, p: [number, number, number] = [0, 0, 0]) => {
    const o = new THREE.Mesh(geo(g), m)
    o.position.set(...p)
    parent.add(o)
    return o
  }
  // Hex bolt heads for panel corners.
  const boltGeo = geo(new THREE.CylinderGeometry(0.022, 0.022, 0.016, 6))
  boltGeo.rotateX(Math.PI / 2)
  const bolts = (parent: THREE.Object3D, hw: number, hh: number, cy: number, z: number) => {
    for (const [bx, by] of [
      [-hw, hh],
      [hw, hh],
      [-hw, -hh],
      [hw, -hh],
    ]) {
      const b = new THREE.Mesh(boltGeo, M.bolt)
      b.position.set(bx, cy + by, z)
      b.rotation.z = 0.3
      parent.add(b)
    }
  }
  const mount = (parent: THREE.Object3D, angle: number, x: number, z: number) => {
    const g = new THREE.Group()
    g.position.set(x, 0, z)
    g.rotation.y = angle
    parent.add(g)
    return g
  }
  const glowPlane = (mat: THREE.Material, w: number, h: number, parent: THREE.Object3D, p: [number, number, number]) => {
    const o = new THREE.Mesh(geo(new THREE.PlaneGeometry(w, h)), mat)
    o.position.set(...p)
    o.renderOrder = 2
    parent.add(o)
    return o
  }

  // Frame-glow plane sized so the texture's ring lines up with an LED ring of ringW × ringH.
  const frameGlowSize = (ringW: number, ringH: number): [number, number] => [(ringW * FRAME_TEX.w) / (2 * FRAME_TEX.bx), (ringH * FRAME_TEX.h) / (2 * FRAME_TEX.by)]
  const barGlowSize = (len: number): [number, number] => {
    const w = (len * BAR_TEX.w) / (2 * BAR_TEX.len)
    return [w, (w * BAR_TEX.h) / BAR_TEX.w]
  }

  // ---- hierarchy: root (float/sway/drag/hover) → body (shake/approach) → base + lid
  const root = new THREE.Group()
  const body = new THREE.Group()
  root.add(body)
  scene.add(root)

  const ledGlowMat = glowMat(frameGlow, 0xa855f7)
  const barGlowMat = glowMat(barGlow, 0xb57bff)
  const seamGlowMat = glowMat(barGlow, 0xc9a6ff)
  const ledLights: THREE.PointLight[] = []

  // An armoured panel with a glowing LED frame (the case's side lights).
  const ledFrame = (parent: THREE.Object3D, w: number, h: number, y: number, withLight: boolean) => {
    mesh(plateZ(ringShape([w, h, 0.12], [w - 0.16, h - 0.18, 0.09]), 0.075, 0.02), M.armor, parent, [0, y, 0])
    bolts(parent, w / 2 - 0.045, h / 2 - 0.1, y, 0.078)
    mesh(plateZ(octagonShape(w - 0.12, h - 0.14, 0.1), 0.03, 0.008), M.ledPanel, parent, [0, y, 0])
    const rw = w - 0.17
    const rh = h - 0.19
    mesh(plateZ(ringShape([rw, rh, 0.095], [rw - 0.05, rh - 0.05, 0.08]), 0.012, 0), M.led, parent, [0, y, 0.03])
    const [gw, gh] = frameGlowSize(rw - 0.025, rh - 0.025)
    glowPlane(ledGlowMat, gw, gh, parent, [0, y, 0.06])
    if (withLight) {
      const l = new THREE.PointLight(0xa855f7, 2.5, 2.4, 2)
      l.position.set(0, y, 0.45)
      parent.add(l)
      ledLights.push(l)
    }
  }

  // ---------------------------------------------------------------- base
  const base = new THREE.Group()
  body.add(base)
  mesh(prismY(ringShape(OUTER, INNER), HB, 0.05), M.body, base)
  mesh(prismY(octagonShape(...OUTER), 0.22, 0.05), M.body, base)
  mesh(prismY(ringShape([W + 0.07, D + 0.07, C + 0.03], [W - 0.1, D - 0.1, C]), 0.15, 0.035), M.armor, base)
  mesh(prismY(ringShape([W + 0.05, D + 0.05, C + 0.02], INNER), 0.085, 0.022), M.armor, base, [0, HB - 0.085, 0])

  // Interior: a dark liner lit purple from below, floor, glowing core and
  // bloom — only seen with the lid open.
  mesh(prismY(ringShape(INNER, [INNER[0] - 0.05, INNER[1] - 0.05, INNER[2] * 0.95]), HB - 0.26, 0), M.liner, base, [0, 0.22, 0])
  {
    const g = new THREE.ShapeGeometry(octagonShape(...INNER))
    g.rotateX(-Math.PI / 2)
    mesh(g, M.interior, base, [0, 0.222, 0])
  }
  const core = mesh(new THREE.CylinderGeometry(0.3, 0.36, 0.05, 6), M.core, base, [0, 0.25, 0])
  const interiorGlowMat = glowMat(radial, 0xa855f7)
  const interiorGlow = glowPlane(interiorGlowMat, W - 2 * T, D - 2 * T, base, [0, 0.235, 0])
  interiorGlow.rotation.x = -Math.PI / 2

  // Front: logo panel, latch keepers, ribs, bottom LED.
  const front = mount(base, 0, 0, D / 2)
  mesh(plateZ(ringShape([1.62, 0.92, 0.1], [1.44, 0.76, 0.075]), 0.06, 0.018), M.armor, front, [0, 0.72, 0])
  bolts(front, 0.76, 0.41, 0.72, 0.062)
  mesh(plateZ(octagonShape(1.5, 0.82, 0.08), 0.026, 0.006), M.inset, front, [0, 0.72, 0])
  mesh(new THREE.PlaneGeometry(1.5, 0.9375), M.logo, front, [0, 0.725, 0.029]).renderOrder = 1
  for (const sx of [-1, 1]) {
    // latch hinge mount (the latch itself is built below, with the lid keepers)
    mesh(plateZ(octagonShape(0.3, 0.13, 0.03), 0.07, 0.015), M.trim, front, [sx * LATCH_X, HB - 0.24, 0])
    mesh(plateZ(octagonShape(0.1, 0.62, 0.03), 0.035, 0.01), M.armor, front, [sx * LATCH_X, 0.66, 0])
    mesh(plateZ(octagonShape(0.018, 0.96, 0), 0.004, 0), M.inset, front, [sx * 1.04, 0.7, 0.001])
  }
  mesh(plateZ(octagonShape(0.98, 0.075, 0.03), 0.012, 0.003), M.inset, front, [0, 0.205, 0])
  mesh(new THREE.BoxGeometry(0.84, 0.024, 0.016), M.led, front, [0, 0.205, 0.016])
  {
    const [w, h] = barGlowSize(0.84)
    glowPlane(barGlowMat, w, h, front, [0, 0.205, 0.03])
  }
  const logoLight = new THREE.PointLight(0x8b5cf6, 1.1, 2.2, 2)
  logoLight.position.set(0, 0.74, 0.55)
  front.add(logoLight)

  // Corner LED frames on the four chamfered corners, frames on the sides.
  const corners: [number, number, number, boolean][] = [
    [Math.PI / 4, 1, 1, true],
    [-Math.PI / 4, -1, 1, true],
    [(3 * Math.PI) / 4, 1, -1, false],
    [(-3 * Math.PI) / 4, -1, -1, false],
  ]
  for (const [ang, sx, sz, light] of corners) ledFrame(mount(base, ang, sx * (W / 2 - C / 2), sz * (D / 2 - C / 2)), 0.62, 1.0, 0.7, light)
  for (const sx of [-1, 1]) ledFrame(mount(base, (sx * Math.PI) / 2, sx * (W / 2), 0), 0.7, 1.0, 0.7, false)

  // Back: panel + hinge leaves.
  const back = mount(base, Math.PI, 0, -D / 2)
  mesh(plateZ(ringShape([1.6, 0.9, 0.1], [1.44, 0.76, 0.08]), 0.05, 0.015), M.armor, back, [0, 0.7, 0])
  for (const sx of [-1, 1]) mesh(plateZ(octagonShape(0.44, 0.18, 0.03), 0.03, 0.01), M.trim, back, [sx * 0.9, HB - 0.1, 0])
  for (const sx of [-1, 1]) {
    const barrel = mesh(new THREE.CylinderGeometry(0.055, 0.055, 0.44, 20), M.trim, body, [sx * 0.9, HB + GAP / 2, -D / 2 - 0.035])
    barrel.rotation.z = Math.PI / 2
  }

  // Seam: a thin line of light between lid and base that charges up.
  const seamRing = mesh(prismY(ringShape([W + 0.02, D + 0.02, C + 0.008], [W - 0.08, D - 0.08, C]), GAP + 0.006, 0), M.seam, body, [0, HB - 0.003, 0])
  seamRing.renderOrder = 1
  {
    const [w, h] = barGlowSize(2.2)
    glowPlane(seamGlowMat, w, h * 0.8, body, [0, HB + GAP / 2, D / 2 + 0.06])
  }

  // ----------------------------------------------------------------- lid
  const lidPivot = new THREE.Group()
  lidPivot.position.set(0, HB + GAP, -D / 2)
  body.add(lidPivot)
  const lid = new THREE.Group()
  lid.position.z = D / 2
  lidPivot.add(lid)
  mesh(prismY(ringShape([W + 0.05, D + 0.05, C + 0.02], INNER), 0.085, 0.022), M.armor, lid)
  mesh(prismY(ringShape(OUTER, INNER), HL - 0.15, 0.04), M.body, lid)
  mesh(prismY(octagonShape(...OUTER), 0.15, 0.07), M.body, lid, [0, HL - 0.15, 0])
  mesh(prismY(octagonShape(W - 0.74, D - 0.62, C * 0.55), 0.05, 0.02), M.armor, lid, [0, HL, 0])
  mesh(prismY(ringShape([W - 1.2, D - 1.0, C * 0.4], [W - 1.34, D - 1.14, C * 0.36]), 0.02, 0), M.inset, lid, [0, HL + 0.05, 0])
  {
    const under = new THREE.ShapeGeometry(octagonShape(...INNER))
    under.rotateX(Math.PI / 2)
    mesh(under, M.interior, lid, [0, HL - 0.152, 0])
    const ring = new THREE.ShapeGeometry(ringShape([INNER[0] - 0.06, INNER[1] - 0.06, INNER[2]], [INNER[0] - 0.16, INNER[1] - 0.16, INNER[2] * 0.9]))
    ring.rotateX(Math.PI / 2)
    mesh(ring, M.lidRing, lid, [0, HL - 0.156, 0])
  }

  const lidFront = mount(lid, 0, 0, D / 2)
  mesh(plateZ(octagonShape(1.56, 0.085, 0.035), 0.012, 0.003), M.inset, lidFront, [0, HL - 0.19, 0])
  mesh(new THREE.BoxGeometry(1.42, 0.028, 0.016), M.led, lidFront, [0, HL - 0.19, 0.016])
  {
    const [w, h] = barGlowSize(1.42)
    glowPlane(barGlowMat, w, h, lidFront, [0, HL - 0.19, 0.03])
  }
  mesh(plateZ(octagonShape(1.5, 0.18, 0.05), 0.035, 0.01), M.armor, lidFront, [0, 0.2, 0])
  // keepers the latches hook over
  for (const sx of [-1, 1]) mesh(plateZ(octagonShape(0.26, 0.12, 0.03), 0.045, 0.012), M.trim, lidFront, [sx * LATCH_X, 0.17, 0])
  for (const [ang, sx, sz] of corners) {
    const f = mount(lid, ang, sx * (W / 2 - C / 2), sz * (D / 2 - C / 2))
    mesh(plateZ(octagonShape(0.62, 0.42, 0.1), 0.07, 0.02), M.armor, f, [0, 0.31, 0])
    mesh(plateZ(octagonShape(0.4, 0.2, 0.06), 0.012, 0.004), M.inset, f, [0, 0.31, 0.07])
    bolts(f, 0.25, 0.14, 0.31, 0.072)
  }
  for (const sx of [-1, 1]) mesh(plateZ(octagonShape(0.72, 0.36, 0.08), 0.06, 0.018), M.armor, mount(lid, (sx * Math.PI) / 2, sx * (W / 2), 0), [0, 0.31, 0])
  {
    const lb = mount(lid, Math.PI, 0, -D / 2)
    for (const sx of [-1, 1]) mesh(plateZ(octagonShape(0.44, 0.16, 0.03), 0.03, 0.01), M.trim, lb, [sx * 0.9, 0.1, 0])
  }

  // Draw latches: hinged low on the base, reaching up over the seam to hook
  // the lid keepers. Released, they swing out and hang open on the front.
  const latches: THREE.Group[] = []
  for (const sx of [-1, 1]) {
    const pivot = new THREE.Group()
    pivot.position.set(sx * LATCH_X, HB - 0.24, 0.085)
    front.add(pivot)
    const shape = polygonShape([
      [-0.11, 0.44],
      [0.11, 0.44],
      [0.11, 0.08],
      [0.055, -0.03],
      [-0.055, -0.03],
      [-0.11, 0.08],
    ])
    mesh(plateZ(shape, 0.07, 0.018), M.metal, pivot, [0, 0, -0.035])
    mesh(plateZ(octagonShape(0.085, 0.16, 0.025), 0.01, 0.003), M.inset, pivot, [0, 0.21, 0.035])
    mesh(plateZ(octagonShape(0.14, 0.04, 0.012), 0.008, 0.002), M.trim, pivot, [0, 0.37, 0.035])
    const barrel = mesh(new THREE.CylinderGeometry(0.04, 0.04, 0.3, 20), M.trim, pivot, [0, 0.02, -0.01])
    barrel.rotation.z = Math.PI / 2
    latches.push(pivot)
  }

  // ------------------------------------------------------ light + effects
  scene.add(new THREE.HemisphereLight(0x8f84ff, 0x07061a, 0.55))
  const key = new THREE.DirectionalLight(0xdfe4ff, 1.5)
  key.position.set(-3.5, 6, 5)
  const rimPurple = new THREE.DirectionalLight(0x8b5cf6, 2.2)
  rimPurple.position.set(5, 3, -4)
  const rimBlue = new THREE.DirectionalLight(0x4f6bff, 1.8)
  rimBlue.position.set(-5, 2.5, -3)
  const fill = new THREE.DirectionalLight(0x9c8cff, 0.45)
  fill.position.set(0, 1.5, 6)
  scene.add(key, rimPurple, rimBlue, fill)

  const interiorLight = new THREE.PointLight(0xb592ff, 0, 3.4, 2)
  interiorLight.position.set(0, 0.5, 0)
  const burstLight = new THREE.PointLight(0xd8c4ff, 0, 7, 2)
  burstLight.position.set(0, HB + 0.7, 0.35)
  body.add(interiorLight, burstLight)

  // Floor: contact shadow, purple bounce and LED light spill (turns with the
  // case), plus an ambient glow behind.
  const floor = new THREE.Group()
  scene.add(floor)
  const flat = (o: THREE.Mesh) => {
    o.rotation.x = -Math.PI / 2
    return o
  }
  const shadowMat = track(new THREE.MeshBasicMaterial({ map: radial, color: 0x000000, transparent: true, opacity: 0.6, depthWrite: false }))
  const shadow = flat(glowPlane(shadowMat, 4.8, 2.9, floor, [0, 0.004, 0]))
  const floorGlowMat = glowMat(radial, 0x7c3aed)
  flat(glowPlane(floorGlowMat, 7.4, 3.9, floor, [0, 0.002, 0.1]))
  const spotMat = glowMat(radial, 0xa855f7)
  for (const sx of [-1, 1]) flat(glowPlane(spotMat, 1.5, 1.1, floor, [sx * (W / 2 - C / 2 + 0.28), 0.005, D / 2 - C / 2 + 0.3]))
  const floorBarMat = glowMat(barGlow, 0xb57bff)
  flat(glowPlane(floorBarMat, 2.1, 0.55, floor, [0, 0.005, D / 2 + 0.3]))
  const backGlowMat = glowMat(radial, 0x6d28d9)
  glowPlane(backGlowMat, 9.5, 5.8, scene, [0, 1.3, -2.4])

  // Volumetric beam out of the open case (elliptical, to fit the opening).
  const beamUniforms = { uColor: { value: new THREE.Color(0xb88cff) }, uOpacity: { value: 0 }, uTime: { value: 0 } }
  const beamMat = track(
    new THREE.ShaderMaterial({
      uniforms: beamUniforms,
      vertexShader: /* glsl */ `
        varying vec2 vUv; varying vec3 vN; varying vec3 vV;
        void main() {
          vUv = uv;
          vec4 wp = modelMatrix * vec4(position, 1.0);
          vN = normalize(mat3(modelMatrix) * normal);
          vV = normalize(cameraPosition - wp.xyz);
          gl_Position = projectionMatrix * viewMatrix * wp;
        }`,
      fragmentShader: /* glsl */ `
        uniform vec3 uColor; uniform float uOpacity; uniform float uTime;
        varying vec2 vUv; varying vec3 vN; varying vec3 vV;
        void main() {
          float facing = abs(dot(normalize(vN), normalize(vV)));
          float edge = pow(facing, 1.8);
          float fade = pow(1.0 - vUv.y, 1.7) * smoothstep(0.0, 0.14, vUv.y);
          float streak = 0.72 + 0.28 * sin(vUv.x * 38.0 + uTime * 1.3) * sin(vUv.x * 15.0 - uTime * 0.7);
          float a = uOpacity * edge * fade * streak;
          gl_FragColor = vec4(uColor * (1.0 + 0.6 * fade), a);
        }`,
      transparent: true,
      depthWrite: false,
      side: THREE.DoubleSide,
      blending: THREE.AdditiveBlending,
    }),
  )
  const beam = mesh(new THREE.CylinderGeometry(1.7, 1.2, 3.6, 48, 1, true), beamMat, body, [0, HB + 1.72, 0])
  beam.scale.z = 0.58
  beam.renderOrder = 3
  const beamCoreMat = track(beamMat.clone())
  beamCoreMat.uniforms = { uColor: { value: new THREE.Color(0xe9ddff) }, uOpacity: { value: 0 }, uTime: beamUniforms.uTime }
  const beamCore = mesh(new THREE.CylinderGeometry(0.8, 0.55, 3.0, 40, 1, true), beamCoreMat, body, [0, HB + 1.45, 0])
  beamCore.scale.z = 0.5
  beamCore.renderOrder = 3

  const rays = new THREE.Group()
  rays.position.set(0, HB + 0.02, 0)
  body.add(rays)
  const rayMat = glowMat(rayTex, 0xcfb4ff)
  const rayGeo = geo(new THREE.PlaneGeometry(0.16, 3.4))
  rayGeo.translate(0, 1.7, 0)
  for (let i = 0; i < 9; i++) {
    const r = new THREE.Mesh(rayGeo, rayMat)
    r.rotation.y = (i / 9) * Math.PI
    r.rotation.z = ((i % 2 ? 1 : -1) * (0.12 + ((i * 37) % 10) / 22))
    r.renderOrder = 3
    rays.add(r)
  }

  const particles = new Particles()
  body.add(particles.points)
  disposables.push(particles)

  const iconSprites = icons.map((map, i) => {
    const s = new THREE.Sprite(track(new THREE.SpriteMaterial({ map, transparent: true, depthWrite: false, opacity: 0, toneMapped: false })))
    s.visible = false
    s.renderOrder = 4
    body.add(s)
    return { sprite: s, x: [-1.15, -0.4, 0.4, 1.15][i], lift: [1.45, 1.95, 1.8, 1.4][i], delay: [0.05, 0, 0.08, 0.12][i] }
  })

  // ------------------------------------------------------------ state
  let mode: CaseMode = options.initial === "open" ? "open" : "closed"
  let kind: "cinematic" | "quick" | "reduced" = "cinematic"
  let reduced = options.reducedMotion ?? false
  let blend: GlowBlend = options.glow ?? "additive"
  let tone: CaseTone = options.tone ?? "brand"
  const framing = FRAMING[options.framing ?? "hero"]
  const idleSway = options.idleSway ?? true
  let simTime = 0
  let modeStart = 0
  const fired = { burst: false, opened: false, closed: false, puff: false }
  let burstAt = -10
  let hoverTarget = 0
  let hover = 0
  let pointer = { x: 0, y: 0 }
  let smoothPointer = { x: 0, y: 0 }
  let dragging = false
  let userYaw = 0
  let userPitch = 0
  let yaw = 0
  let pitch = 0
  let swayWeight = 1
  let openSmooth = mode === "open" ? 1 : 0
  let seamAcc = 0
  let ambAcc = 0
  let aspect = 1
  let viewH = 600
  let disposed = false

  const toneA = new THREE.Color()
  const toneB = new THREE.Color()
  const applyTone = () => {
    toneA.setHex(TONES[tone].a)
    toneB.setHex(TONES[tone].b)
    M.core.color.copy(toneA).lerp(new THREE.Color(0xffffff), 0.25)
    M.interior.emissive.copy(toneA).multiplyScalar(0.5)
    M.liner.emissive.copy(toneA).multiplyScalar(0.8)
    interiorLight.color.copy(toneA).lerp(new THREE.Color(0xffffff), 0.3)
    beamUniforms.uColor.value.copy(toneA).lerp(new THREE.Color(0xffffff), 0.25)
    interiorGlow.material = interiorGlowMat
    glows.find((g) => g.mat === interiorGlowMat)!.color.copy(toneA)
  }
  applyTone()

  const applyBlend = () => {
    const b = blend === "additive" ? THREE.AdditiveBlending : THREE.NormalBlending
    for (const g of glows) {
      g.mat.blending = b
      g.mat.needsUpdate = true
    }
    for (const m of [beamMat, beamCoreMat, particles.material]) {
      m.blending = b
      m.needsUpdate = true
    }
    iconSprites.forEach(({ sprite }) => {
      ;(sprite.material as THREE.SpriteMaterial).blending = THREE.NormalBlending
    })
  }
  applyBlend()

  const setMode = (m: CaseMode) => {
    mode = m
    modeStart = simTime
    fired.burst = fired.opened = fired.closed = fired.puff = false
  }

  // Random point on the seam perimeter (body space).
  const seamPts = (() => {
    const pts: THREE.Vector2[] = []
    const x = W / 2
    const y = D / 2
    const verts = [
      [-x + C, -y],
      [x - C, -y],
      [x, -y + C],
      [x, y - C],
      [x - C, y],
      [-x + C, y],
      [-x, y - C],
      [-x, -y + C],
    ]
    for (let i = 0; i < verts.length; i++) {
      const [ax, ay] = verts[i]
      const [bx, by] = verts[(i + 1) % verts.length]
      const n = Math.max(2, Math.round(Math.hypot(bx - ax, by - ay) * 12))
      for (let k = 0; k < n; k++) pts.push(new THREE.Vector2(ax + ((bx - ax) * k) / n, -(ay + ((by - ay) * k) / n)))
    }
    return pts
  })()
  const pColors = [0xb18cff, 0xe2d6ff, 0x7fa2ff, 0xf0abfc].map((c) => new THREE.Color(c))
  const pick = () => (Math.random() < 0.35 ? toneA : pColors[(Math.random() * pColors.length) | 0])

  const emitSeam = (n: number) => {
    for (let i = 0; i < n; i++) {
      const p = seamPts[(Math.random() * seamPts.length) | 0]
      const out = new THREE.Vector2(p.x, p.y).normalize()
      particles.spawn(p.x, HB + GAP / 2, p.y, out.x * (0.2 + Math.random() * 0.4), 0.2 + Math.random() * 0.5, out.y * (0.2 + Math.random() * 0.4), 0.5 + Math.random() * 0.5, 0.05 + Math.random() * 0.05, pick())
    }
  }
  const emitBurst = (n: number, power: number) => {
    for (let i = 0; i < n; i++) {
      const x = (Math.random() - 0.5) * 2.4
      const z = (Math.random() - 0.5) * 1.2
      particles.spawn(x, HB - 0.05, z, x * 0.5 + (Math.random() - 0.5) * 0.8 * power, (2 + Math.random() * 2.8) * power, z * 0.4 + (Math.random() - 0.5) * 0.5, 1.1 + Math.random() * 1.1, 0.06 + Math.random() * 0.08, pick())
    }
  }
  const emitAmbient = (n: number) => {
    for (let i = 0; i < n; i++) {
      particles.spawn((Math.random() - 0.5) * 2.2, HB, (Math.random() - 0.5) * 1.0, (Math.random() - 0.5) * 0.15, 0.35 + Math.random() * 0.55, (Math.random() - 0.5) * 0.1, 2 + Math.random() * 1.4, 0.04 + Math.random() * 0.05, pick())
    }
  }
  const emitPuff = (n: number) => {
    for (let i = 0; i < n; i++) {
      const p = seamPts[(Math.random() * seamPts.length) | 0]
      const out = new THREE.Vector2(p.x, p.y).normalize()
      particles.spawn(p.x, HB + 0.01, p.y, out.x * (0.6 + Math.random() * 0.8), 0.05 + Math.random() * 0.2, out.y * (0.6 + Math.random() * 0.8), 0.4 + Math.random() * 0.35, 0.05 + Math.random() * 0.04, pColors[0])
    }
  }

  const ledBase = new THREE.Color(0xb57bff)
  const ledHot = new THREE.Color(0xf1e6ff)

  function update(dt: number, snap = false) {
    simTime += dt
    const t = simTime - modeStart
    let P: Params
    if (mode === "opening") {
      P = openParams(t, kind)
      if (!fired.burst && t >= OPEN_BURST[kind]) {
        fired.burst = true
        burstAt = simTime
        if (kind !== "reduced") emitBurst(kind === "cinematic" ? 150 : 70, kind === "cinematic" ? 1 : 0.75)
        options.onBurst?.()
      }
      if (!fired.opened && t >= OPEN_REVEAL[kind]) {
        fired.opened = true
        options.onOpened?.()
      }
      if (t >= OPEN_DONE[kind]) setMode("open")
    } else if (mode === "closing") {
      P = closeParams(t, reduced)
      if (!reduced && !fired.puff && t >= CLOSE_IMPACT) {
        fired.puff = true
        emitPuff(26)
      }
      if (t >= (reduced ? CLOSE_DONE.reduced : CLOSE_DONE.normal)) {
        setMode("closed")
        if (!fired.closed) {
          fired.closed = true
          options.onClosed?.()
        }
      }
    } else {
      P = mode === "open" ? OPEN : CLOSED
    }

    const k = (lambda: number) => (snap ? 1 : 1 - Math.exp(-lambda * dt))

    // Lid + latches.
    lidPivot.rotation.x = P.lid
    for (const l of latches) l.rotation.x = P.latch

    // Body: approach, shake, thud.
    const s = reduced ? 0 : P.shake
    const tt = simTime
    body.position.set(
      s * 0.032 * Math.sin(tt * 71) * Math.sin(tt * 13),
      s * 0.018 * Math.sin(tt * 57 + 1.3) - 0.028 * P.thud,
      0.3 * P.approach + s * 0.01 * Math.sin(tt * 43),
    )
    body.rotation.set(s * 0.012 * Math.sin(tt * 49), 0, s * 0.02 * Math.sin(tt * 63 + 0.4))

    // Root: float, sway, parallax, drag, hover.
    hover = lerp(hover, hoverTarget, k(8))
    smoothPointer.x = lerp(smoothPointer.x, pointer.x, k(5))
    smoothPointer.y = lerp(smoothPointer.y, pointer.y, k(5))
    swayWeight = lerp(swayWeight, mode === "opening" || !idleSway || reduced ? 0 : 1, k(3))
    if (!dragging) {
      userYaw = lerp(userYaw, 0, k(1.6))
      userPitch = lerp(userPitch, 0, k(2))
    }
    const sway = 0.2 * Math.sin(tt * 0.42) * swayWeight
    yaw = lerp(yaw, sway + smoothPointer.x * 0.26 + userYaw, k(dragging ? 22 : 5))
    pitch = lerp(pitch, -smoothPointer.y * 0.08 + userPitch, k(dragging ? 22 : 5))
    root.rotation.set(pitch, yaw, 0)
    floor.rotation.y = yaw
    floor.position.z = body.position.z
    const floatY = reduced ? 0.06 : 0.06 + 0.045 * Math.sin(tt * 1.65)
    root.position.y = floatY
    root.scale.setScalar(1 + 0.025 * hover)
    shadow.scale.setScalar(1 - (floatY - 0.06) * 1.5)
    shadowMat.opacity = (blend === "additive" ? 0.55 : 0.35) * (1 - (floatY - 0.015) * 2.2)

    // Lighting + glow.
    const glowScale = blend === "additive" ? 1 : 0.55
    const boost = clamp01(0.3 * hover + 0.9 * P.charge + P.burst)
    M.led.color.copy(ledBase).lerp(ledHot, clamp01(boost * 0.65))
    ledGlowMat.opacity = (0.5 + 0.5 * boost) * glowScale
    barGlowMat.opacity = (0.6 + 0.4 * boost) * glowScale
    for (const l of ledLights) l.intensity = 2.4 * (1 + 1.3 * boost)
    M.ledPanel.emissiveIntensity = 0.18 + 0.5 * boost
    M.metal.emissiveIntensity = 0.9 * clamp01(P.latchFlash)
    M.seam.opacity = clamp01(0.16 + 0.84 * P.charge + P.burst)
    M.seam.color.copy(ledBase).lerp(ledHot, clamp01(P.charge + P.burst))
    seamGlowMat.opacity = clamp01(0.9 * P.charge + P.burst) * glowScale
    logoLight.intensity = 1.1 + 1.5 * boost

    const shimmer = 0.88 + 0.12 * Math.sin(tt * 3.1)
    interiorGlowMat.opacity = P.interior * shimmer * glowScale
    M.core.opacity = P.interior
    M.interior.emissiveIntensity = 0.22 * P.interior
    M.liner.emissiveIntensity = 0.35 * P.interior * shimmer
    M.lidRing.opacity = P.interior * 0.9
    interiorLight.intensity = P.interior * 9 * shimmer + P.burst * 24
    spotMat.opacity = (0.32 + 0.3 * boost) * glowScale
    floorBarMat.opacity = (0.4 + 0.3 * boost) * glowScale
    burstLight.intensity = P.burst * 55
    core.rotation.y = tt * 0.6

    beamUniforms.uTime.value = tt
    beamUniforms.uOpacity.value = P.beam * 0.42
    beamCoreMat.uniforms.uOpacity.value = P.beam * 0.34 + P.burst * 0.4
    beam.visible = beamCore.visible = P.beam > 0.002 || P.burst > 0.002
    rayMat.opacity = clamp01(P.rays) * 0.55 * glowScale
    rays.visible = P.rays > 0.002
    rays.rotation.y = tt * 0.25

    floorGlowMat.opacity = clamp01(0.42 + 0.15 * hover + 0.18 * P.charge + 0.35 * P.burst + 0.18 * P.interior) * glowScale
    backGlowMat.opacity = clamp01(0.28 + 0.2 * P.charge + 0.35 * P.burst + 0.1 * P.interior) * glowScale
    for (const g of glows) g.mat.color.copy(g.color)

    // Particles: sparks off the seam while charging, a slow rise while open.
    if (!reduced) {
      seamAcc += (mode === "opening" && kind === "cinematic" ? P.charge * 60 * (1 - P.burst) : 0) * dt
      ambAcc += (P.interior > 0.5 ? 10 : 0) * dt
      const ns = Math.floor(seamAcc)
      const na = Math.floor(ambAcc)
      seamAcc -= ns
      ambAcc -= na
      if (ns) emitSeam(ns)
      if (na) emitAmbient(na)
    }
    particles.update(dt, 1.1)
    particles.material.uniforms.uScale.value = (renderer.getPixelRatio() * viewH) / (2 * Math.tan(THREE.MathUtils.degToRad(framing.fov / 2)))

    // Reward icons rising out of the burst.
    const since = simTime - burstAt
    for (const ic of iconSprites) {
      const q = (since - ic.delay) / (kind === "cinematic" ? 1.9 : 1.4)
      if (reduced || q < 0 || q > 1) {
        ic.sprite.visible = false
        continue
      }
      ic.sprite.visible = true
      const e = easeOutCubic(q)
      ic.sprite.position.set(ic.x * e, HB + 0.2 + e * ic.lift, 0.15)
      const sc = 0.62 * easeOutBack(clamp01(q * 2.4), 1.6)
      ic.sprite.scale.set(sc, sc, 1)
      ;(ic.sprite.material as THREE.SpriteMaterial).opacity = q < 0.12 ? q / 0.12 : q > 0.68 ? (1 - q) / 0.32 : 1
      ;(ic.sprite.material as THREE.SpriteMaterial).rotation = Math.sin(simTime * 2 + ic.x * 3) * 0.12
    }

    // Camera: frame the case, pulling back as the lid rises.
    const openAmt = clamp01(P.lid / LID_OPEN)
    openSmooth = lerp(openSmooth, openAmt, k(3.5))
    const cy = lerp(framing.closed[0], framing.open[0], openSmooth)
    const hh = lerp(framing.closed[1], framing.open[1], openSmooth)
    const tanH = Math.tan(THREE.MathUtils.degToRad(framing.fov / 2))
    const dist = Math.max(framing.halfW / (tanH * aspect), hh / tanH)
    camera.fov = framing.fov
    camera.position.set(0, cy + Math.sin(framing.elev) * dist, Math.cos(framing.elev) * dist)
    camera.lookAt(0, cy, 0)
    camera.updateProjectionMatrix()
  }

  // ------------------------------------------------------------ loop
  let raf = 0
  let visible = true
  let last = 0
  const frame = (now: number) => {
    raf = requestAnimationFrame(frame)
    const dt = last ? Math.min(0.05, (now - last) / 1000) : 1 / 60
    last = now
    update(dt)
    renderer.render(scene, camera)
  }
  const start = () => {
    if (raf || disposed) return
    last = 0
    raf = requestAnimationFrame(frame)
  }
  const stop = () => {
    if (raf) cancelAnimationFrame(raf)
    raf = 0
  }

  const ready = logo.ready.then(() => {
    if (!disposed) renderer.compile(scene, camera)
  })

  const controller: CaseSceneController = {
    ready,
    open(opts) {
      if (mode !== "closed") return false
      kind = reduced ? "reduced" : opts?.cinematic === false ? "quick" : "cinematic"
      setMode("opening")
      return true
    },
    close() {
      if (mode !== "open") return false
      setMode("closing")
      return true
    },
    toggle() {
      return mode === "closed" ? controller.open({ cinematic: false }) : mode === "open" ? controller.close() : false
    },
    setState(state) {
      setMode(state)
      openSmooth = state === "open" ? 1 : 0
    },
    mode: () => mode,
    busy: () => mode === "opening" || mode === "closing",
    setTone(t) {
      tone = t
      applyTone()
    },
    setGlowBlend(b) {
      if (b === blend) return
      blend = b
      applyBlend()
    },
    setReducedMotion(r) {
      reduced = r
    },
    setHover(h) {
      hoverTarget = h ? 1 : 0
    },
    setPointer(x, y) {
      pointer = { x: Math.max(-1, Math.min(1, x)), y: Math.max(-1, Math.min(1, y)) }
    },
    dragBy(dx, dy) {
      dragging = true
      userYaw += dx * 0.012
      userPitch = Math.max(-0.35, Math.min(0.3, userPitch + dy * 0.005))
    },
    endDrag() {
      dragging = false
    },
    setVisible(v) {
      visible = v
      if (visible) start()
      else stop()
    },
    resize(width, height, dpr) {
      if (width < 2 || height < 2) return
      renderer.setPixelRatio(dpr)
      renderer.setSize(width, height, false)
      aspect = width / height
      viewH = height
      camera.aspect = aspect
      camera.updateProjectionMatrix()
      if (!raf) {
        update(0, true)
        renderer.render(scene, camera)
      }
    },
    // Deterministic render of one moment of an animation (used by the visual
    // test harness): simulates from the start of `m` to time `t`, then draws.
    renderAt(m, t, opts) {
      stop()
      particles.reset()
      simTime = 0
      burstAt = -10
      seamAcc = ambAcc = 0
      kind = reduced ? "reduced" : opts?.cinematic === false ? "quick" : "cinematic"
      setMode(m)
      openSmooth = m === "open" || m === "closing" ? 1 : 0
      hover = hoverTarget = opts?.hover ?? 0
      swayWeight = 0
      dragging = true // hold the requested angle instead of springing back
      userYaw = opts?.yaw ?? 0
      userPitch = opts?.pitch ?? 0
      const step = 1 / 60
      if (m === "closed") simTime = t
      else for (let x = 0; x < t; x += step) update(step)
      update(0, true)
      dragging = false
      renderer.render(scene, camera)
    },
    dispose() {
      disposed = true
      stop()
      for (const d of disposables) d.dispose()
      renderer.dispose()
      // Free the WebGL context now rather than at GC — browsers cap live contexts.
      renderer.forceContextLoss()
    },
  }

  if (visible) start()
  return controller
}
