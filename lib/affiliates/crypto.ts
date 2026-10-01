import { INVALID_TRC20_MESSAGE, TRON_NETWORK, TRON_STANDARD, USDT_ASSET, base58Decode, normalizeTronAddress, sha256, tronAddressProblem } from "./tron"

// The crypto payout methods, each one a fixed asset on a fixed network — never
// "USDT, pick a network". Pure and dependency-free, so the SAME address check
// runs in the browser (inline feedback) and on the server (the one that counts).

export const CRYPTO_METHOD_TYPES = ["crypto_trc20", "crypto_aptos", "crypto_ltc"] as const
export type CryptoMethodType = (typeof CRYPTO_METHOD_TYPES)[number]

export const APTOS_NETWORK = "APTOS"
export const LITECOIN_NETWORK = "LITECOIN"
export const LTC_ASSET = "LTC"

export type CryptoSpec = {
  type: CryptoMethodType
  asset: string // USDT | LTC
  assetName: string // "USDT" | "Litecoin"
  network: string // what a payout stores: TRON | APTOS | LITECOIN
  networkLabel: string // "TRON (TRC-20)"
  standard: string // "TRC-20" — the short form used in copy
  title: string // the method's name in the picker
  summary: string // "USDT · TRC-20 / TRON"
  // true when one unit is one US dollar (a stablecoin); false when the amount
  // has to be converted at the market price when the payout is sent.
  usdPegged: boolean
  decimals: number
  // true when a transaction a person sent by hand can be checked on-chain here.
  verifiable: boolean
  // the chain id the exchange uses for this network
  exchangeChain: string
  placeholder: string
  maxLength: number
  // inline errors start once this much has been typed
  minLength: number
  defaultNickname: string
  invalidMessage: string
  networkOnlyMessage: string
  confirmMessage: string
  confirmLabel: string
  warnings: string[]
  // the address is compared case-insensitively (hex), or exactly (base58)
  caseInsensitive: boolean
  normalize(value: unknown): string
  // null = a well-formed address for this network
  addressProblem(value: unknown): string | null
  // a transaction id of this network inside whatever a provider reports, or null
  hashFrom(text: string | null | undefined): string | null
  explorerTx(hash: string): string
}

const trim = (value: unknown) => String(value ?? "").trim()
const hex64 = (text: string | null | undefined) => /(?:^|[^0-9a-fA-F])([0-9a-fA-F]{64})(?![0-9a-fA-F])/.exec(` ${text ?? ""}`)?.[1]?.toLowerCase() ?? null

// --- Aptos ------------------------------------------------------------------------
// An account address is 32 bytes, written 0x + 64 hex characters. There is no
// checksum, so the format is all that can be checked — which is why the last
// characters are typed again before a wallet is saved.

const normalizeAptos = (value: unknown) => trim(value).toLowerCase()

export function aptosAddressProblem(value: unknown): string | null {
  const address = normalizeAptos(value)
  if (!address) return "Enter your wallet address."
  if (!address.startsWith("0x")) return "An Aptos address starts with 0x."
  if (address.length !== 66) return "An Aptos address is 66 characters long: 0x followed by 64 characters."
  if (!/^0x[0-9a-f]{64}$/.test(address)) return "An Aptos address only contains the digits 0–9 and the letters a–f."
  // 0x0…01 and friends are the network's own system accounts, not wallets.
  if (/^0x0{32}/.test(address)) return "That is a system address, not a wallet."
  return null
}

// --- Litecoin ---------------------------------------------------------------------
// Three address forms are accepted: L… (legacy), M… (script) and ltc1q… (native
// segwit). Each carries a checksum, so a single mistyped character is caught.

const BECH32 = "qpzry9x8gf2tvdw0s3jn54khce6mua7l"

function bech32Polymod(values: number[]): number {
  const GEN = [0x3b6a57b2, 0x26508e6d, 0x1ea119fa, 0x3d4233dd, 0x2a1462b3]
  let chk = 1
  for (const v of values) {
    const top = chk >>> 25
    chk = ((chk & 0x1ffffff) << 5) ^ v
    for (let i = 0; i < 5; i++) if ((top >>> i) & 1) chk ^= GEN[i]
  }
  return chk >>> 0
}

// The witness version and program of a bech32 address with this prefix, or null.
function decodeSegwit(prefix: string, address: string): { version: number; program: number[]; checksum: number } | null {
  if (address !== address.toLowerCase() && address !== address.toUpperCase()) return null
  const lower = address.toLowerCase()
  if (!lower.startsWith(`${prefix}1`)) return null
  const data: number[] = []
  for (const ch of lower.slice(prefix.length + 1)) {
    const v = BECH32.indexOf(ch)
    if (v < 0) return null
    data.push(v)
  }
  if (data.length < 7) return null
  const expanded = [...Array.from(prefix, (c) => c.charCodeAt(0) >>> 5), 0, ...Array.from(prefix, (c) => c.charCodeAt(0) & 31)]
  const checksum = bech32Polymod([...expanded, ...data])
  // 5-bit groups → bytes, no padding allowed
  const program: number[] = []
  let acc = 0
  let bits = 0
  for (const v of data.slice(1, -6)) {
    acc = ((acc << 5) | v) & 0xfff
    bits += 5
    while (bits >= 8) {
      bits -= 8
      program.push((acc >>> bits) & 0xff)
    }
  }
  if (bits >= 5 || (acc & ((1 << bits) - 1)) !== 0) return null
  return { version: data[0], program, checksum }
}

const normalizeLitecoin = (value: unknown) => {
  const v = trim(value)
  return /^ltc1/i.test(v) ? v.toLowerCase() : v
}

export function litecoinAddressProblem(value: unknown): string | null {
  const address = normalizeLitecoin(value)
  if (!address) return "Enter your wallet address."
  if (/^ltcmweb1/i.test(address)) return "MWEB (ltcmweb1…) addresses can't be paid to. Use an L…, M… or ltc1q… address."
  if (/^ltc1/i.test(address)) {
    const decoded = decodeSegwit("ltc", address)
    // version 0 is checked with bech32 (1), later versions with bech32m
    const typo = !decoded || decoded.checksum !== (decoded.version === 0 ? 1 : 0x2bc830a3)
    if (typo) return "The address has a typo — its checksum doesn't match."
    if (decoded.version !== 0) return "Taproot (ltc1p…) addresses can't be paid to. Use an L…, M… or ltc1q… address."
    if (decoded.program.length !== 20 && decoded.program.length !== 32) return "That isn't a Litecoin address."
    return null
  }
  if (!/^[LM3]/.test(address)) return "A Litecoin address starts with L, M or ltc1."
  if (address.startsWith("3")) return "Use the M… form of this address — the old 3… form is easily confused with Bitcoin."
  if (address.length < 26 || address.length > 35) return "A Litecoin address is 26 to 35 characters long."
  const raw = base58Decode(address)
  if (!raw) return "The address contains characters a Litecoin address can't have (0, O, I and l are never used)."
  if (raw.length !== 25 || (raw[0] !== 0x30 && raw[0] !== 0x32)) return "That isn't a Litecoin address."
  const check = sha256(sha256(raw.subarray(0, 21)))
  for (let i = 0; i < 4; i++) if (check[i] !== raw[21 + i]) return "The address has a typo — its checksum doesn't match."
  return null
}

// --- The methods -------------------------------------------------------------------

const LOSS = "Sending funds to an incompatible network may result in permanent loss of funds."

export const CRYPTO: Record<CryptoMethodType, CryptoSpec> = {
  crypto_trc20: {
    type: "crypto_trc20",
    asset: USDT_ASSET,
    assetName: "USDT",
    network: TRON_NETWORK,
    networkLabel: "TRON (TRC-20)",
    standard: TRON_STANDARD,
    title: "USDT — TRC-20",
    summary: "USDT · TRC-20 / TRON",
    usdPegged: true,
    decimals: 6,
    verifiable: true,
    exchangeChain: "trx",
    placeholder: "T…",
    maxLength: 40,
    minLength: 34,
    defaultNickname: "USDT wallet",
    invalidMessage: INVALID_TRC20_MESSAGE,
    networkOnlyMessage: "USDT payouts are sent on the TRON (TRC-20) network only.",
    confirmMessage: "Confirm that this wallet supports USDT on TRC-20.",
    confirmLabel: "I confirm that this wallet address supports USDT on TRC-20.",
    warnings: ["USDT will be sent using the TRON (TRC-20) network.", "Only use a wallet address that supports USDT on TRC-20.", LOSS],
    caseInsensitive: false,
    normalize: normalizeTronAddress,
    addressProblem: tronAddressProblem,
    hashFrom: hex64,
    explorerTx: (hash) => `https://tronscan.org/#/transaction/${hash}`,
  },
  crypto_aptos: {
    type: "crypto_aptos",
    asset: USDT_ASSET,
    assetName: "USDT",
    network: APTOS_NETWORK,
    networkLabel: "Aptos",
    standard: "Aptos",
    title: "USDT — Aptos",
    summary: "USDT · Aptos",
    usdPegged: true,
    decimals: 6,
    verifiable: false,
    exchangeChain: "aptos",
    placeholder: "0x…",
    maxLength: 70,
    minLength: 66,
    defaultNickname: "USDT wallet (Aptos)",
    invalidMessage: "Invalid Aptos wallet address. Please check the address and make sure it belongs to a wallet that supports USDT on the Aptos network.",
    networkOnlyMessage: "This payout method sends USDT on the Aptos network only.",
    confirmMessage: "Confirm that this wallet supports USDT on Aptos.",
    confirmLabel: "I confirm that this wallet address supports USDT on the Aptos network.",
    warnings: ["USDT will be sent using the Aptos network.", "Only use a wallet address that supports USDT on Aptos. Copy and paste it — an Aptos address has no built-in typo check.", LOSS],
    caseInsensitive: true,
    normalize: normalizeAptos,
    addressProblem: aptosAddressProblem,
    hashFrom: (text) => {
      const hash = hex64(text)
      return hash ? `0x${hash}` : null
    },
    explorerTx: (hash) => `https://explorer.aptoslabs.com/txn/${hash}?network=mainnet`,
  },
  crypto_ltc: {
    type: "crypto_ltc",
    asset: LTC_ASSET,
    assetName: "Litecoin",
    network: LITECOIN_NETWORK,
    networkLabel: "Litecoin",
    standard: "Litecoin",
    title: "Litecoin — LTC",
    summary: "Litecoin (LTC)",
    usdPegged: false,
    decimals: 8,
    verifiable: false,
    exchangeChain: "ltc",
    placeholder: "ltc1… / L… / M…",
    maxLength: 70,
    minLength: 34,
    defaultNickname: "Litecoin wallet",
    invalidMessage: "Invalid Litecoin wallet address. Please check the address and make sure it is a Litecoin (LTC) address.",
    networkOnlyMessage: "This payout method sends Litecoin on the Litecoin network only.",
    confirmMessage: "Confirm that this is a Litecoin (LTC) wallet address.",
    confirmLabel: "I confirm that this is a Litecoin (LTC) wallet address.",
    warnings: ["Litecoin (LTC) will be sent on the Litecoin network.", "Your payout is calculated in US dollars and converted to LTC at the market price at the moment it is sent.", "Only use a Litecoin address. Funds sent to an address on another network are lost for good."],
    caseInsensitive: false,
    normalize: normalizeLitecoin,
    addressProblem: litecoinAddressProblem,
    hashFrom: hex64,
    explorerTx: (hash) => `https://blockchair.com/litecoin/transaction/${hash}`,
  },
}

export const isCryptoMethod = (type: string | null | undefined): type is CryptoMethodType => !!type && Object.prototype.hasOwnProperty.call(CRYPTO, type)
export const cryptoSpec = (type: string | null | undefined): CryptoSpec | null => (isCryptoMethod(type) ? CRYPTO[type] : null)
const BY_NETWORK = new Map(Object.values(CRYPTO).map((s) => [s.network, s]))
export const cryptoSpecByNetwork = (network: string | null | undefined): CryptoSpec | null => (network ? (BY_NETWORK.get(network) ?? null) : null)

// The public explorer page for a transaction. Built only from the payout's own
// network and a transaction id of that network's shape — never from anything
// free-form.
export function explorerTxUrl(network: string | null | undefined, hash: string | null | undefined): string | null {
  const spec = cryptoSpecByNetwork(network)
  const clean = spec?.hashFrom(hash)
  if (!spec || !clean || clean.replace(/^0x/, "") !== (hash ?? "").trim().toLowerCase().replace(/^0x/, "")) return null
  return spec.explorerTx(clean)
}

// "1.5 LTC", "120 USDT" — an amount of the asset itself, without padding zeros.
export function formatAsset(amount: number, asset: string, decimals = 8): string {
  const text = amount.toFixed(decimals).replace(/\.?0+$/, "")
  return `${text} ${asset}`
}
