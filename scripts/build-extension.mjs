// Packages the browser extension in extension/.
//
//   node scripts/build-extension.mjs
//       → public/extension/tradeloop-tradingview.zip, the download the
//         pairing page offers until the extension is in the Chrome Web Store.
//
//   node scripts/build-extension.mjs --dev --out DIR --base URL --tv URL [--poll SECONDS]
//       → an unpacked build in DIR that pairs with the TradeLoop at URL and
//         reads a stand-in TradingView at URL (the e2e tests run one), for
//         Chrome's "Load unpacked".
//
// The zip is written by hand (deflate + CRC-32) so the build needs nothing
// beyond Node; the checked-in zip is rebuilt whenever extension/ changes.
import fs from "node:fs"
import path from "node:path"
import zlib from "node:zlib"
import { fileURLToPath } from "node:url"

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..")
const source = path.join(root, "extension")

const args = process.argv.slice(2)
const flag = (name) => {
  const i = args.indexOf(name)
  return i === -1 ? undefined : args[i + 1]
}
const dev = args.includes("--dev")

function listFiles(dir, prefix = "") {
  const out = []
  for (const entry of fs.readdirSync(dir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
    const rel = prefix ? `${prefix}/${entry.name}` : entry.name
    if (entry.isDirectory()) out.push(...listFiles(path.join(dir, entry.name), rel))
    else if (!entry.name.endsWith(".md")) out.push(rel)
  }
  return out
}

// The dev build points every address at the local stand-ins: manifest match
// patterns and host permissions, and the values config.js keeps between
// its markers.
function devPattern(url) {
  const u = new URL(url)
  return `${u.protocol}//${u.host}/*`
}

function transform(rel, content) {
  if (!dev) return content
  const base = flag("--base")
  const tv = flag("--tv")
  const poll = Number(flag("--poll") ?? 4)
  if (!base || !tv) throw new Error("--dev needs --base and --tv")

  if (rel === "manifest.json") {
    const manifest = JSON.parse(content.toString("utf8"))
    manifest.name += " (dev)"
    manifest.host_permissions = [devPattern(tv), devPattern(base)]
    manifest.content_scripts[0].matches = [devPattern(tv)]
    manifest.content_scripts[1].matches = [devPattern(base)]
    return Buffer.from(JSON.stringify(manifest, null, 2) + "\n")
  }
  if (rel === "config.js") {
    const text = content.toString("utf8")
    const start = text.indexOf("// BEGIN build-time values")
    const end = text.indexOf("// END build-time values")
    if (start === -1 || end === -1) throw new Error("config.js lost its build markers")
    const version = JSON.parse(fs.readFileSync(path.join(source, "manifest.json"), "utf8")).version
    const values = [
      "// BEGIN build-time values (development build)",
      `  version: ${JSON.stringify(version + "-dev")},`,
      `  defaultBaseUrl: ${JSON.stringify(new URL(base).origin)},`,
      `  paperHosts: { pro: ${JSON.stringify(new URL(tv).origin)}, free: ${JSON.stringify(new URL(tv).origin)} },`,
      `  tradingviewMatches: ${JSON.stringify([devPattern(tv)])},`,
      `  tradingviewUrl: ${JSON.stringify(new URL(tv).origin + "/chart/")},`,
      `  pollSeconds: ${poll},`,
      "  ",
    ].join("\n")
    return Buffer.from(text.slice(0, start) + values + text.slice(end))
  }
  return content
}

// ---- a small zip writer ---------------------------------------------------

const CRC_TABLE = new Uint32Array(256).map((_, n) => {
  let c = n
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
  return c >>> 0
})
function crc32(buffer) {
  let crc = 0xffffffff
  for (const byte of buffer) crc = CRC_TABLE[(crc ^ byte) & 0xff] ^ (crc >>> 8)
  return (crc ^ 0xffffffff) >>> 0
}
function dosDateTime(date) {
  const time = (date.getHours() << 11) | (date.getMinutes() << 5) | Math.floor(date.getSeconds() / 2)
  const day = ((date.getFullYear() - 1980) << 9) | ((date.getMonth() + 1) << 5) | date.getDate()
  return { time, day }
}
function zip(entries) {
  const locals = []
  const centrals = []
  let offset = 0
  // A fixed timestamp keeps the zip byte-identical for identical sources.
  const { time, day } = dosDateTime(new Date(2026, 0, 1, 12, 0, 0))
  for (const { name, data } of entries) {
    const nameBytes = Buffer.from(name, "utf8")
    const deflated = zlib.deflateRawSync(data, { level: 9 })
    const crc = crc32(data)
    const local = Buffer.alloc(30)
    local.writeUInt32LE(0x04034b50, 0)
    local.writeUInt16LE(20, 4) // version needed
    local.writeUInt16LE(0x0800, 6) // utf-8 names
    local.writeUInt16LE(8, 8) // deflate
    local.writeUInt16LE(time, 10)
    local.writeUInt16LE(day, 12)
    local.writeUInt32LE(crc, 14)
    local.writeUInt32LE(deflated.length, 18)
    local.writeUInt32LE(data.length, 22)
    local.writeUInt16LE(nameBytes.length, 26)
    local.writeUInt16LE(0, 28)
    locals.push(local, nameBytes, deflated)

    const central = Buffer.alloc(46)
    central.writeUInt32LE(0x02014b50, 0)
    central.writeUInt16LE(20, 4) // version made by
    central.writeUInt16LE(20, 6) // version needed
    central.writeUInt16LE(0x0800, 8)
    central.writeUInt16LE(8, 10)
    central.writeUInt16LE(time, 12)
    central.writeUInt16LE(day, 14)
    central.writeUInt32LE(crc, 16)
    central.writeUInt32LE(deflated.length, 20)
    central.writeUInt32LE(data.length, 24)
    central.writeUInt16LE(nameBytes.length, 28)
    central.writeUInt16LE(0, 30) // extra
    central.writeUInt16LE(0, 32) // comment
    central.writeUInt16LE(0, 34) // disk
    central.writeUInt16LE(0, 36) // internal attrs
    central.writeUInt32LE(0, 38) // external attrs
    central.writeUInt32LE(offset, 42)
    centrals.push(central, nameBytes)
    offset += local.length + nameBytes.length + deflated.length
  }
  const centralBytes = Buffer.concat(centrals)
  const end = Buffer.alloc(22)
  end.writeUInt32LE(0x06054b50, 0)
  end.writeUInt16LE(0, 4)
  end.writeUInt16LE(0, 6)
  end.writeUInt16LE(entries.length, 8)
  end.writeUInt16LE(entries.length, 10)
  end.writeUInt32LE(centralBytes.length, 12)
  end.writeUInt32LE(offset, 16)
  end.writeUInt16LE(0, 20)
  return Buffer.concat([...locals, centralBytes, end])
}

// ---- build ----------------------------------------------------------------

const files = listFiles(source).map((rel) => ({ name: rel, data: transform(rel, fs.readFileSync(path.join(source, rel))) }))

if (dev) {
  const out = path.resolve(flag("--out") ?? path.join(root, ".extension-dev"))
  fs.rmSync(out, { recursive: true, force: true })
  for (const { name, data } of files) {
    const target = path.join(out, name)
    fs.mkdirSync(path.dirname(target), { recursive: true })
    fs.writeFileSync(target, data)
  }
  console.log(`unpacked dev extension → ${out} (${files.length} files)`)
} else {
  const outDir = path.join(root, "public", "extension")
  fs.mkdirSync(outDir, { recursive: true })
  const target = path.join(outDir, "tradeloop-tradingview.zip")
  const bytes = zip(files)
  fs.writeFileSync(target, bytes)
  const version = JSON.parse(fs.readFileSync(path.join(source, "manifest.json"), "utf8")).version
  fs.writeFileSync(path.join(outDir, "version.json"), JSON.stringify({ version }) + "\n")
  console.log(`${path.relative(root, target)} — v${version}, ${files.length} files, ${bytes.length} bytes`)
}
