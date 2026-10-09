import { test } from "node:test"
import assert from "node:assert/strict"
import { PROVISION_STEPS, STATUS_AFTER_PROVISIONING, nextStep, statusForStep, statusFromBroker } from "@/lib/vps/provisioning"

test("provisioning steps run in order and then wait for the client's auth", () => {
  assert.equal(PROVISION_STEPS[0], "create_server")
  assert.equal(nextStep("create_server"), "wait_for_windows")
  assert.equal(nextStep("install_addon"), "configure_device")
  assert.equal(nextStep("health_check"), null) // last step
  assert.equal(STATUS_AFTER_PROVISIONING, "awaiting_auth")
})

test("each step maps to the right instance status", () => {
  assert.equal(statusForStep("create_server"), "provisioning")
  assert.equal(statusForStep("wait_for_windows"), "installing")
  assert.equal(statusForStep("install_ninjatrader"), "installing")
  assert.equal(statusForStep("configure_device"), "configuring")
  assert.equal(statusForStep("start_services"), "configuring")
  assert.equal(statusForStep("health_check"), "ready")
})

test("the broker connection (observed, never set by TradeLoop) drives connected/disconnected", () => {
  assert.equal(statusFromBroker("awaiting_auth", true), "connected")
  assert.equal(statusFromBroker("ready", true), "connected")
  assert.equal(statusFromBroker("connected", false), "disconnected")
  assert.equal(statusFromBroker("ready", false), "awaiting_auth") // ready with no broker waits for auth
  assert.equal(statusFromBroker("awaiting_auth", false), "awaiting_auth")
  // terminal/error states are never moved by a heartbeat
  assert.equal(statusFromBroker("destroyed", true), "destroyed")
  assert.equal(statusFromBroker("error", true), "error")
})
