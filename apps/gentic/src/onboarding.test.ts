import assert from "node:assert/strict"
import { test } from "node:test"

import {
  formatOnboardingUnmet,
  getOnboardingStatus,
} from "./onboarding.js"
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
