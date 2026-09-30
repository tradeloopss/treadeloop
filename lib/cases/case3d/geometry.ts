import * as THREE from "three"

// Geometry helpers for the TradeLoop loot case. Everything is built from one
// primitive: a chamfered rectangle ("octagon") — w × h with 45° corner cuts of
// size c — extruded with a 1-segment bevel, which gives the hard, machined
// chamfers of the reference case.

export type Oct = [w: number, h: number, c: number]

export function octagonPoints(w: number, h: number, c: number): THREE.Vector2[] {
  const x = w / 2
  const y = h / 2
  const k = Math.min(c, x - 1e-4, y - 1e-4)
  if (k <= 1e-4) {
    return [new THREE.Vector2(-x, -y), new THREE.Vector2(x, -y), new THREE.Vector2(x, y), new THREE.Vector2(-x, y)]
  }
  return [
    new THREE.Vector2(-x + k, -y),
    new THREE.Vector2(x - k, -y),
    new THREE.Vector2(x, -y + k),
    new THREE.Vector2(x, y - k),
    new THREE.Vector2(x - k, y),
    new THREE.Vector2(-x + k, y),
    new THREE.Vector2(-x, y - k),
    new THREE.Vector2(-x, -y + k),
  ]
}

export function octagonShape(w: number, h: number, c: number): THREE.Shape {
  return new THREE.Shape(octagonPoints(w, h, c))
}

// An octagon with an octagonal hole — walls, frames and rings.
export function ringShape(outer: Oct, inner: Oct): THREE.Shape {
  const s = octagonShape(...outer)
  s.holes.push(new THREE.Path(octagonPoints(...inner)))
  return s
}

export function polygonShape(points: [number, number][]): THREE.Shape {
  return new THREE.Shape(points.map(([x, y]) => new THREE.Vector2(x, y)))
}

// Extrude along +Z from z=0 to z=depth with a chamfer of `bevel` that stays
// inside the outline (walls sit exactly on the shape, caps are inset).
function extrude(shape: THREE.Shape, depth: number, bevel: number): THREE.ExtrudeGeometry {
  const b = Math.max(0, Math.min(bevel, depth / 2 - 1e-4))
  const g = new THREE.ExtrudeGeometry(shape, {
    depth: Math.max(1e-4, depth - 2 * b),
    bevelEnabled: b > 0,
    bevelThickness: b,
    bevelSize: b,
    bevelOffset: -b,
    bevelSegments: 1,
    curveSegments: 1,
    steps: 1,
  })
  g.translate(0, 0, b)
  return g
}

// A vertical prism: the shape is the footprint (x = width, y = depth — shape
// +y maps to world −z), extruded upward from y=0 to y=height.
export function prismY(shape: THREE.Shape, height: number, bevel: number): THREE.BufferGeometry {
  const g = extrude(shape, height, bevel)
  g.rotateX(-Math.PI / 2)
  return g
}

// A plate facing +Z: the shape lies in the XY plane, extruded from z=0 to
// z=thickness. Used for everything mounted on a face of the case.
export function plateZ(shape: THREE.Shape, thickness: number, bevel: number): THREE.BufferGeometry {
  return extrude(shape, thickness, bevel)
}
