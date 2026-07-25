import assert from "node:assert/strict"
import { test } from "node:test"

import {
  formatOnboardingUnmet,
  getOnboardingStatus,
  ONBOARDING_STEPS,
  runOnboarding,
} from "./onboarding.js"
import type { OnboardingStatus } from "./onboarding.js"
import type { ToolStatuses } from "./tools.js"

const readyTool = {
  installed: true,
  authenticated: true,
  version: "1.0.0",
}

const missingTool = {
  installed: false,
  authenticated: false,
  version: null,
}

test("getOnboardingStatus reports ready when credentials, gh, and one agent are authenticated", async () => {
  const status = await getOnboardingStatus({
    configInput: {
      GENTIC_API_KEY: "test-key",
      GENTIC_API_URL: "https://gentic.example/api/v1",
    },
    getTools: async (agentProviders): Promise<ToolStatuses> => {
      assert.deepEqual(agentProviders, ["claude_code", "codex"])
      return {
        github: readyTool,
        claude: missingTool,
        codex: readyTool,
      }
    },
  })

  assert.equal(status.ready, true)
  assert.deepEqual(status.unmet, [])
  assert.deepEqual(status.agentProviders, ["claude_code", "codex"])
})

test("getOnboardingStatus reports unmet credentials, github auth, and agent auth", async () => {
  const status = await getOnboardingStatus({
    configInput: {
      GENTIC_API_URL: "https://gentic.example/api/v1",
      AGENT_PROVIDERS: ["codex"],
    },
    getTools: async (agentProviders): Promise<ToolStatuses> => {
      assert.deepEqual(agentProviders, ["codex"])
      return {
        github: { ...readyTool, authenticated: false },
        codex: { ...readyTool, authenticated: false },
      }
    },
  })

  assert.equal(status.ready, false)
  assert.deepEqual(status.unmet, [
    "gentic-auth",
    "github-cli-authenticated",
    "agent-cli-authenticated",
  ])
  assert.deepEqual(status.auth.missing, ["GENTIC_API_KEY"])
  assert.ok(
    formatOnboardingUnmet(status).some((line) =>
      line.includes("missing GENTIC_API_KEY")
    )
  )
})

test("getOnboardingStatus reports agent install only when no selected agent CLI exists", async () => {
  const status = await getOnboardingStatus({
    configInput: {
      GENTIC_API_KEY: "test-key",
      GENTIC_API_URL: "https://gentic.example/api/v1",
      AGENT_PROVIDERS: ["claude_code", "codex"],
    },
    getTools: async (): Promise<ToolStatuses> => ({
      github: readyTool,
      claude: missingTool,
      codex: missingTool,
    }),
  })

  assert.deepEqual(status.unmet, ["agent-cli-installed"])
})

function makeStatus(authenticated: boolean): OnboardingStatus {
  return {
    ready: authenticated,
    auth: {
      authenticated,
      apiUrl: authenticated ? "https://gentic.example/api/v1" : undefined,
      maskedApiKey: authenticated ? "tes...-key" : undefined,
      missing: authenticated
        ? []
        : ["GENTIC_API_KEY", "GENTIC_API_URL"],
    },
    agentProviders: ["codex"],
    tools: {
      github: readyTool,
      codex: readyTool,
    },
    unmet: authenticated ? [] : ["gentic-auth"],
  }
}

function createUiRecorder() {
  const messages: string[] = []
  return {
    messages,
    ui: {
      intro: (message?: string) => {
        messages.push(`intro:${message}`)
      },
      outro: (message?: string) => {
        messages.push(`outro:${message}`)
      },
      info: (message: string) => {
        messages.push(`info:${message}`)
      },
      success: (message: string) => {
        messages.push(`success:${message}`)
      },
      warn: (message: string) => {
        messages.push(`warn:${message}`)
      },
    },
  }
}

test("runOnboarding shows welcome and skips auth prompt when already authenticated", async () => {
  const { messages, ui } = createUiRecorder()
  let loginCalls = 0

  await runOnboarding({
    getStatus: async () => makeStatus(true),
    runAuthLogin: async () => {
      loginCalls += 1
      return { cancelled: false, apiKeyConfigured: true }
    },
    ui,
  })

  assert.equal(loginCalls, 0)
  assert.equal(messages[0], "intro:Welcome to Gentic")
  assert.ok(
    messages.includes(
      `info:Step 1/${ONBOARDING_STEPS.length}: Gentic auth`
    )
  )
  assert.ok(
    messages.some((message) =>
      message.startsWith("success:Gentic auth already configured")
    )
  )
})

test("runOnboarding calls auth prompt when credentials are missing", async () => {
  const { messages, ui } = createUiRecorder()
  let loginCalls = 0
  const statuses = [makeStatus(false), makeStatus(true)]

  await runOnboarding({
    getStatus: async () => statuses.shift() ?? makeStatus(true),
    runAuthLogin: async () => {
      loginCalls += 1
      return { cancelled: false, apiKeyConfigured: true }
    },
    ui,
  })

  assert.equal(loginCalls, 1)
  assert.ok(
    messages.includes(`info:Step 2/${ONBOARDING_STEPS.length}: GitHub CLI`)
  )
  assert.ok(
    messages.includes(`info:Step 4/${ONBOARDING_STEPS.length}: Worker service`)
  )
  assert.equal(messages.at(-1), "outro:Onboarding checks complete.")
})
