import assert from "node:assert/strict"
import { test } from "node:test"

import {
  checkOnboardingGate,
  shouldBypassOnboardingGate,
} from "./cli-gate.js"
import type { OnboardingStatus } from "./onboarding.js"

const readyStatus: OnboardingStatus = {
  ready: true,
  auth: {
    authenticated: true,
    apiUrl: "https://gentic.example/api/v1",
    maskedWorkerCredential: "gen...test",
    missing: [],
  },
  agentProviders: ["codex"],
  tools: {
    github: { installed: true, authenticated: true, version: "1.0.0" },
    codex: { installed: true, authenticated: true, version: "1.0.0" },
  },
  unmet: [],
}

const unmetStatus: OnboardingStatus = {
  ready: false,
  auth: {
    authenticated: false,
    missing: ["GENTIC_WORKER_CREDENTIAL", "GENTIC_API_URL"],
  },
  agentProviders: ["codex"],
  tools: {
    github: { installed: true, authenticated: true, version: "1.0.0" },
    codex: { installed: true, authenticated: true, version: "1.0.0" },
  },
  unmet: ["gentic-auth"],
}

test("shouldBypassOnboardingGate bypasses help, version, and auth subtree", () => {
  assert.equal(shouldBypassOnboardingGate(["node", "gentic", "--help"]), true)
  assert.equal(
    shouldBypassOnboardingGate(["node", "gentic", "run", "--help"]),
    true
  )
  assert.equal(shouldBypassOnboardingGate(["node", "gentic", "--version"]), true)
  assert.equal(
    shouldBypassOnboardingGate(["node", "gentic", "auth", "login"]),
    true
  )
  assert.equal(shouldBypassOnboardingGate(["node", "gentic", "run"]), false)
})

test("checkOnboardingGate returns when onboarding is already satisfied", async () => {
  await checkOnboardingGate({
    argv: ["node", "gentic", "run"],
    getStatus: async () => readyStatus,
    exit: () => {
      throw new Error("exit should not be called")
    },
  })
})

test("checkOnboardingGate runs onboarding and exits before dispatch for TTY stdin", async () => {
  let prompted = false
  await assert.rejects(
    checkOnboardingGate({
      argv: ["node", "gentic", "run"],
      stdin: { isTTY: true },
      getStatus: async () => unmetStatus,
      runOnboarding: async () => {
        prompted = true
      },
      exit: (code?: number): never => {
        throw new Error(`exit:${code}`)
      },
    }),
    /exit:0/
  )
  assert.equal(prompted, true)
})

test("checkOnboardingGate prints setup instructions and exits 1 without prompting for non-TTY stdin", async () => {
  let output = ""
  let prompted = false

  await assert.rejects(
    checkOnboardingGate({
      argv: ["node", "gentic", "run"],
      stdin: { isTTY: false },
      stderr: {
        write(chunk: string | Uint8Array): boolean {
          output += String(chunk)
          return true
        },
      },
      getStatus: async () => unmetStatus,
      runOnboarding: async () => {
        prompted = true
      },
      exit: (code?: number): never => {
        throw new Error(`exit:${code}`)
      },
    }),
    /exit:1/
  )

  assert.equal(prompted, false)
  assert.match(output, /GENTIC_WORKER_CREDENTIAL and GENTIC_API_URL/)
  assert.match(
    output,
    /gentic auth login --worker-credential \.\.\. --api-url \.\.\./
  )
})
