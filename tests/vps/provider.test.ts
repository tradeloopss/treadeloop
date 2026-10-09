import { test } from "node:test"
import assert from "node:assert/strict"
import { getVpsProvider, vpsProviderIsReal } from "@/lib/vps/provider"

test("the mock provider is the default and is clearly not real", async () => {
  const p = getVpsProvider({} as NodeJS.ProcessEnv)
  assert.equal(p.id, "mock")
  assert.equal(p.real, false)
  assert.equal(vpsProviderIsReal({} as NodeJS.ProcessEnv), false)

  const info = await p.createServer({ userId: "u1", instanceId: 7 })
  assert.match(info.providerServerId, /^mock-7-/)
  assert.match(info.publicIp ?? "", /^192\.0\.2\./) // RFC 5737 TEST-NET — never routable
  assert.match(info.operatingSystem ?? "", /simulated/i)
})

test("selecting an unimplemented provider fails loudly rather than pretending", () => {
  assert.throws(() => getVpsProvider({ VPS_PROVIDER: "hetzner" } as unknown as NodeJS.ProcessEnv), /not implemented/)
  assert.equal(vpsProviderIsReal({ VPS_PROVIDER: "hetzner" } as unknown as NodeJS.ProcessEnv), false)
})
