import crypto from "node:crypto"

// AES-256-GCM at-rest encryption for broker credentials. Never log or return
// decrypted values to the client — decrypt only inside server actions that
// call the broker API directly.
function getKey(): Buffer {
  const secret = process.env.BROKER_CREDENTIALS_KEY
  if (!secret) throw new Error("BROKER_CREDENTIALS_KEY is not set")
  const key = Buffer.from(secret, "hex")
  if (key.length !== 32) throw new Error("BROKER_CREDENTIALS_KEY must be 32 bytes (64 hex chars)")
  return key
}

export function encrypt(plaintext: string): string {
  const iv = crypto.randomBytes(12)
  const cipher = crypto.createCipheriv("aes-256-gcm", getKey(), iv)
  const ciphertext = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()])
  const authTag = cipher.getAuthTag()
  return [iv.toString("base64"), authTag.toString("base64"), ciphertext.toString("base64")].join(".")
}

export function decrypt(payload: string): string {
  const [ivB64, tagB64, dataB64] = payload.split(".")
  if (!ivB64 || !tagB64 || !dataB64) throw new Error("Malformed encrypted payload")
  const decipher = crypto.createDecipheriv("aes-256-gcm", getKey(), Buffer.from(ivB64, "base64"))
  decipher.setAuthTag(Buffer.from(tagB64, "base64"))
  const plaintext = Buffer.concat([decipher.update(Buffer.from(dataB64, "base64")), decipher.final()])
  return plaintext.toString("utf8")
}
