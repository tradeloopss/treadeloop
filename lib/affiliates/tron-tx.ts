import { secp256k1 } from "@noble/curves/secp256k1"
import { keccak_256 } from "@noble/hashes/sha3"
import { USDT_TRC20_CONTRACT, fromHex, sha256, toHex, tronAddressFromHex, tronAddressToHex } from "./tron"

// Building and signing a USDT (TRC-20) transfer, entirely locally and
// deterministically. Nothing here touches the network and nothing here reads
// the environment: the caller passes the key in and gets bytes back.
//
// The transaction is ENCODED HERE, field by field, rather than taken from a
// node's "build me a transaction" endpoint — so what gets signed is exactly
// what this code constructed: this contract, this recipient, this amount.
// A node (or anything in between) never gets to hand us something to sign.

const TRANSFER_SELECTOR = "a9059cbb" // transfer(address,uint256)
const TYPE_URL = "type.googleapis.com/protocol.TriggerSmartContract"
const TRIGGER_SMART_CONTRACT = 31

// --- protobuf (just what a Transaction needs) -----------------------------------

function varint(value: number | bigint): number[] {
  let v = BigInt(value)
  if (v < BigInt(0)) throw new Error("Negative varint")
  const out: number[] = []
  while (v >= BigInt(0x80)) {
    out.push(Number(v & BigInt(0x7f)) | 0x80)
    v >>= BigInt(7)
  }
  out.push(Number(v))
  return out
}
const tag = (field: number, wire: 0 | 2) => varint((field << 3) | wire)
const bytesField = (field: number, data: Uint8Array | number[]) => [...tag(field, 2), ...varint(data.length), ...data]
const intField = (field: number, value: number | bigint) => [...tag(field, 0), ...varint(value)]
const ascii = (s: string) => Array.from(s, (c) => c.charCodeAt(0))

export type TransferInput = {
  from: string // base58 owner (the sending wallet)
  to: string // base58 recipient
  units: bigint // USDT in its smallest unit (6 decimals)
  refBlockBytes: string // hex, 2 bytes: the reference block's number, low 16 bits
  refBlockHash: string // hex, 8 bytes: bytes 8..16 of the reference block's id
  expiration: number // ms; the transaction can never be included after this
  timestamp: number // ms
  feeLimit: number // sun; the most TRX this transaction may burn
  contract?: string // base58; defaults to the USDT contract
}

// ABI-encoded call data: transfer(to, units).
export function transferCallData(to: string, units: bigint): string {
  const account = tronAddressToHex(to)
  if (!account) throw new Error("The recipient isn't a valid TRON address.")
  if (units <= BigInt(0)) throw new Error("The amount must be positive.")
  return TRANSFER_SELECTOR + account.padStart(64, "0") + units.toString(16).padStart(64, "0")
}

// Transaction.raw, serialised. Its SHA-256 is the transaction id.
export function encodeTransferRaw(input: TransferInput): Uint8Array {
  const owner = tronAddressToHex(input.from)
  const contract = tronAddressToHex(input.contract ?? USDT_TRC20_CONTRACT)
  if (!owner || !contract) throw new Error("Invalid sender or contract address.")
  if (!/^[0-9a-fA-F]{4}$/.test(input.refBlockBytes) || !/^[0-9a-fA-F]{16}$/.test(input.refBlockHash)) throw new Error("Invalid reference block.")
  if (!Number.isSafeInteger(input.expiration) || !Number.isSafeInteger(input.timestamp) || !Number.isSafeInteger(input.feeLimit) || input.feeLimit <= 0) throw new Error("Invalid transaction parameters.")

  const trigger = [...bytesField(1, fromHex(`41${owner}`)), ...bytesField(2, fromHex(`41${contract}`)), ...bytesField(4, fromHex(transferCallData(input.to, input.units)))]
  const any = [...bytesField(1, ascii(TYPE_URL)), ...bytesField(2, trigger)]
  const contractMsg = [...intField(1, TRIGGER_SMART_CONTRACT), ...bytesField(2, any)]
  return new Uint8Array([
    ...bytesField(1, fromHex(input.refBlockBytes)),
    ...bytesField(4, fromHex(input.refBlockHash)),
    ...intField(8, input.expiration),
    ...bytesField(11, contractMsg),
    ...intField(14, input.timestamp),
    ...intField(18, input.feeLimit),
  ])
}

export const transactionId = (raw: Uint8Array) => toHex(sha256(raw))

// The reference-block fields for a block: its number's low 16 bits, and bytes
// 8..16 of its id. They tie the transaction to this chain and this moment.
export function refBlock(blockId: string): { refBlockBytes: string; refBlockHash: string } {
  if (!/^[0-9a-fA-F]{64}$/.test(blockId)) throw new Error("Invalid block id.")
  return { refBlockBytes: blockId.slice(12, 16).toLowerCase(), refBlockHash: blockId.slice(16, 32).toLowerCase() }
}

// --- keys and signatures --------------------------------------------------------

const cleanKey = (privateKey: string) => {
  const hex = privateKey.trim().replace(/^0x/, "")
  if (!/^[0-9a-fA-F]{64}$/.test(hex)) throw new Error("The payout wallet key must be 64 hexadecimal characters.")
  return hex
}

export const privateKeyValid = (privateKey: string | null | undefined): boolean => {
  try {
    return secp256k1.utils.isValidPrivateKey(fromHex(cleanKey(privateKey ?? "")))
  } catch {
    return false
  }
}

// keccak-256 of the uncompressed public key, last 20 bytes — the account.
function accountOf(publicKey: Uint8Array): string {
  return toHex(keccak_256(publicKey.subarray(1)).subarray(12))
}

export function addressFromPrivateKey(privateKey: string): string {
  return tronAddressFromHex(accountOf(secp256k1.getPublicKey(fromHex(cleanKey(privateKey)), false)))
}

// 65 bytes: r, s, v — v as 27/28, the form TRON's own tooling emits.
export function signTransactionId(txId: string, privateKey: string): string {
  const sig = secp256k1.sign(fromHex(txId), fromHex(cleanKey(privateKey)), { lowS: true })
  return toHex(sig.toCompactRawBytes()) + (27 + sig.recovery).toString(16)
}

// Who signed this transaction id — what a node computes to accept or reject it.
export function recoverSigner(txId: string, signature: string): string | null {
  try {
    const bytes = fromHex(signature)
    if (bytes.length !== 65) return null
    const v = bytes[64] >= 27 ? bytes[64] - 27 : bytes[64]
    if (v !== 0 && v !== 1) return null
    const point = secp256k1.Signature.fromCompact(bytes.subarray(0, 64)).addRecoveryBit(v).recoverPublicKey(fromHex(txId))
    return tronAddressFromHex(accountOf(point.toRawBytes(false)))
  } catch {
    return null
  }
}

// Transaction { raw_data = 1; signature = 2 } — what /wallet/broadcasthex takes.
export function encodeSignedTransaction(raw: Uint8Array, signature: string): string {
  return toHex(new Uint8Array([...bytesField(1, raw), ...bytesField(2, fromHex(signature))]))
}

export type SignedTransfer = { txId: string; rawHex: string; signature: string; signedHex: string; expiration: number }

// Build, sign, and check our own work: the signature must recover to the
// sending wallet, or nothing is returned to broadcast.
export function buildSignedTransfer(input: TransferInput, privateKey: string): SignedTransfer {
  if (addressFromPrivateKey(privateKey) !== input.from) throw new Error("The payout wallet key doesn't belong to the configured payout wallet address.")
  const raw = encodeTransferRaw(input)
  const txId = transactionId(raw)
  const signature = signTransactionId(txId, privateKey)
  if (recoverSigner(txId, signature) !== input.from) throw new Error("Signature self-check failed. Nothing was sent.")
  return { txId, rawHex: toHex(raw), signature, signedHex: encodeSignedTransaction(raw, signature), expiration: input.expiration }
}
