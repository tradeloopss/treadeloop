// TRON address handling for USDT (TRC-20) payouts. Pure and dependency-free,
// so the SAME check runs in the browser (inline feedback) and on the server
// (the one that counts). No keys, no signing — this only reads addresses.

export const TRON_NETWORK = "TRON"
export const TRON_STANDARD = "TRC-20"
export const USDT_ASSET = "USDT"
// The USDT (Tether) TRC-20 contract on TRON mainnet.
export const USDT_TRC20_CONTRACT = "TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t"
export const USDT_DECIMALS = 6

const ALPHABET = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz"

// prettier-ignore
const K = new Uint32Array([
  0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5, 0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
  0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da, 0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
  0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85, 0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
  0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3, 0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
])

// SHA-256, synchronous, so the checksum can be verified while typing.
export function sha256(data: Uint8Array): Uint8Array {
  const h = new Uint32Array([0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19])
  const bits = data.length * 8
  const padded = new Uint8Array((((data.length + 8) >> 6) + 1) << 6)
  padded.set(data)
  padded[data.length] = 0x80
  const view = new DataView(padded.buffer)
  view.setUint32(padded.length - 8, Math.floor(bits / 0x100000000))
  view.setUint32(padded.length - 4, bits >>> 0)
  const w = new Uint32Array(64)
  const rotr = (x: number, n: number) => (x >>> n) | (x << (32 - n))
  for (let off = 0; off < padded.length; off += 64) {
    for (let i = 0; i < 16; i++) w[i] = view.getUint32(off + i * 4)
    for (let i = 16; i < 64; i++) {
      const s0 = rotr(w[i - 15], 7) ^ rotr(w[i - 15], 18) ^ (w[i - 15] >>> 3)
      const s1 = rotr(w[i - 2], 17) ^ rotr(w[i - 2], 19) ^ (w[i - 2] >>> 10)
      w[i] = (w[i - 16] + s0 + w[i - 7] + s1) >>> 0
    }
    let [a, b, c, d, e, f, g, hh] = h
    for (let i = 0; i < 64; i++) {
      const S1 = rotr(e, 6) ^ rotr(e, 11) ^ rotr(e, 25)
      const ch = (e & f) ^ (~e & g)
      const t1 = (hh + S1 + ch + K[i] + w[i]) >>> 0
      const S0 = rotr(a, 2) ^ rotr(a, 13) ^ rotr(a, 22)
      const maj = (a & b) ^ (a & c) ^ (b & c)
      const t2 = (S0 + maj) >>> 0
      hh = g
      g = f
      f = e
      e = (d + t1) >>> 0
      d = c
      c = b
      b = a
      a = (t1 + t2) >>> 0
    }
    h[0] = (h[0] + a) >>> 0
    h[1] = (h[1] + b) >>> 0
    h[2] = (h[2] + c) >>> 0
    h[3] = (h[3] + d) >>> 0
    h[4] = (h[4] + e) >>> 0
    h[5] = (h[5] + f) >>> 0
    h[6] = (h[6] + g) >>> 0
    h[7] = (h[7] + hh) >>> 0
  }
  const out = new Uint8Array(32)
  const ov = new DataView(out.buffer)
  for (let i = 0; i < 8; i++) ov.setUint32(i * 4, h[i])
  return out
}

export function base58Decode(value: string): Uint8Array | null {
  let n = BigInt(0)
  for (const ch of value) {
    const i = ALPHABET.indexOf(ch)
    if (i < 0) return null
    n = n * BigInt(58) + BigInt(i)
  }
  const bytes: number[] = []
  while (n > BigInt(0)) {
    bytes.unshift(Number(n & BigInt(0xff)))
    n >>= BigInt(8)
  }
  // each leading "1" is a leading zero byte
  for (const ch of value) {
    if (ch !== "1") break
    bytes.unshift(0)
  }
  return new Uint8Array(bytes)
}

const toHex = (bytes: Uint8Array) => Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("")

export const normalizeTronAddress = (value: unknown) => String(value ?? "").trim()

// The 21 payload bytes (0x41 + 20-byte account) of a valid mainnet address,
// or the reason it isn't one.
function decodeTron(address: string): { bytes: Uint8Array } | { problem: string } {
  if (!address) return { problem: "Enter your wallet address." }
  if (!address.startsWith("T")) return { problem: "A TRON (TRC-20) address starts with the letter T." }
  if (address.length !== 34) return { problem: "A TRON (TRC-20) address is 34 characters long." }
  const raw = base58Decode(address)
  if (!raw) return { problem: "The address contains characters a TRON address can't have (0, O, I and l are never used)." }
  if (raw.length !== 25 || raw[0] !== 0x41) return { problem: "That isn't a TRON mainnet address." }
  const check = sha256(sha256(raw.subarray(0, 21)))
  for (let i = 0; i < 4; i++) if (check[i] !== raw[21 + i]) return { problem: "The address has a typo — its checksum doesn't match." }
  return { bytes: raw.subarray(0, 21) }
}

// null = a well-formed TRON mainnet address (format, length, alphabet AND
// checksum, so a single mistyped character is caught).
export function tronAddressProblem(value: unknown): string | null {
  const r = decodeTron(normalizeTronAddress(value))
  return "problem" in r ? r.problem : null
}

export const INVALID_TRC20_MESSAGE = "Invalid TRC-20 wallet address. Please check the address and make sure it belongs to a wallet that supports USDT on the TRON network."

// The 20-byte account as lowercase hex — how the address appears in contract
// event logs (without the 0x41 network prefix).
export function tronAddressToHex(value: unknown): string | null {
  const r = decodeTron(normalizeTronAddress(value))
  return "bytes" in r ? toHex(r.bytes.subarray(1)) : null
}

// TXYZ…8291 — the only form a wallet address takes in the UI.
export function maskAddress(address: string | null | undefined): string {
  const v = (address ?? "").trim()
  return v.length > 10 ? `${v.slice(0, 4)}…${v.slice(-4)}` : v || "—"
}

export const isTxHash = (value: unknown): value is string => typeof value === "string" && /^[0-9a-fA-F]{64}$/.test(value.trim())
export const maskTxHash = (hash: string | null | undefined) => (hash && hash.length > 12 ? `${hash.slice(0, 6)}…${hash.slice(-4)}` : hash || "—")

// The public explorer page for a transaction. Built only from the configured
// network and a validated hash — never from anything free-form.
export function explorerTxUrl(network: string | null | undefined, hash: string | null | undefined): string | null {
  if (network !== TRON_NETWORK || !isTxHash(hash)) return null
  return `https://tronscan.org/#/transaction/${hash.trim().toLowerCase()}`
}

// USDT has 6 decimals on TRON: $420.00 → 420000000 units.
export const usdtUnits = (amount: number) => BigInt(Math.round(amount * 10 ** USDT_DECIMALS))
export const usdtFromUnits = (units: bigint) => Number(units) / 10 ** USDT_DECIMALS
