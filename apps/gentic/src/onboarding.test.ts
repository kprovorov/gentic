import assert from "node:assert/strict"
import { chmod, mkdtemp, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { test } from "node:test"

import {
  ensureAgentCliForOnboarding,
  ensureGithubCliForOnboarding,
  formatOnboardingUnmet,
  getGithubInstallCommand,
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

test("getGithubInstallCommand returns the macOS brew command", async () => {
  const dir = await mkdtemp(join(tmpdir(), "gentic-onboarding-brew-"))
  try {
    const brew = join(dir, "brew")
    await writeFile(brew, "#!/bin/sh\nexit 0\n")
    await chmod(brew, 0o755)

    assert.deepEqual(getGithubInstallCommand("darwin", dir), {
      command: "brew",
      args: ["install", "gh"],
      display: "brew install gh",
    })
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

test("getGithubInstallCommand errors on macOS without brew", () => {
  assert.throws(
    () => getGithubInstallCommand("darwin", ""),
    /https:\/\/brew\.sh\//
  )
})

test("getGithubInstallCommand returns the Linux package manager command", async () => {
  const dir = await mkdtemp(join(tmpdir(), "gentic-onboarding-apt-"))
  try {
    const aptGet = join(dir, "apt-get")
    await writeFile(aptGet, "#!/bin/sh\nexit 0\n")
    await chmod(aptGet, 0o755)

    assert.deepEqual(getGithubInstallCommand("linux", dir), {
      command: "sudo",
      args: ["apt-get", "install", "-y", "gh"],
      display: "sudo apt-get install -y gh",
    })
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

test("getGithubInstallCommand errors on Linux without a supported package manager", () => {
  assert.throws(
    () => getGithubInstallCommand("linux", ""),
    /https:\/\/cli\.github\.com\//
  )
})

test("ensureGithubCliForOnboarding skips when gh is installed and authenticated", async () => {
  let prompts = 0
  let spawns = 0

  await ensureGithubCliForOnboarding({
    checkGithub: async () => readyTool,
    confirm: async () => {
      prompts += 1
      return true
    },
    spawnInteractive: async () => {
      spawns += 1
    },
  })

  assert.equal(prompts, 0)
  assert.equal(spawns, 0)
})

test("ensureGithubCliForOnboarding installs and authenticates gh", async () => {
  const dir = await mkdtemp(join(tmpdir(), "gentic-onboarding-install-"))
  const statuses = [
    missingTool,
    { installed: true, authenticated: false, version: "2.0.0" },
    readyTool,
  ]
  const prompts: string[] = []
  const spawns: string[] = []

  try {
    const aptGet = join(dir, "apt-get")
    await writeFile(aptGet, "#!/bin/sh\nexit 0\n")
    await chmod(aptGet, 0o755)

    await ensureGithubCliForOnboarding({
      platform: "linux",
      path: dir,
      checkGithub: async () => statuses.shift() ?? readyTool,
      confirm: async ({ message }) => {
        prompts.push(message)
        return true
      },
      spawnInteractive: async (command, args) => {
        spawns.push([command, ...args].join(" "))
      },
    })
  } finally {
    await rm(dir, { recursive: true, force: true })
  }

  assert.deepEqual(prompts, [
    "Install GitHub CLI with `sudo apt-get install -y gh`?",
    "Authenticate GitHub CLI with `gh auth login`?",
  ])
  assert.deepEqual(spawns, ["sudo apt-get install -y gh", "gh auth login"])
})

test("ensureGithubCliForOnboarding exits immediately when install is declined", async () => {
  const dir = await mkdtemp(join(tmpdir(), "gentic-onboarding-decline-"))
  let exitCode: number | undefined
  let message: string | undefined

  try {
    const aptGet = join(dir, "apt-get")
    await writeFile(aptGet, "#!/bin/sh\nexit 0\n")
    await chmod(aptGet, 0o755)

    await assert.rejects(
      ensureGithubCliForOnboarding({
        platform: "linux",
        path: dir,
        checkGithub: async () => missingTool,
        confirm: async () => false,
        cancel: (value) => {
          message = value
        },
        spawnInteractive: async () => {
          throw new Error("should not spawn")
        },
        exit: (code): never => {
          exitCode = code
          throw new Error("exited")
        },
      }),
      /exited/
    )
  } finally {
    await rm(dir, { recursive: true, force: true })
  }

  assert.equal(
    message,
    "gh is required to run gentic. Install and authenticate GitHub CLI, then run onboarding again."
  )
  assert.equal(exitCode, 1)
})

test("ensureAgentCliForOnboarding returns live status when one agent is authenticated", async () => {
  const status = await ensureAgentCliForOnboarding({
    getStatus: async () => ({
      ready: true,
      auth: {
        authenticated: true,
        apiUrl: "https://gentic.example/api/v1",
        maskedApiKey: "tes...-key",
        missing: [],
      },
      agentProviders: ["claude_code", "codex"],
      tools: {
        github: readyTool,
        claude: missingTool,
        codex: readyTool,
      },
      unmet: [],
    }),
    exit: () => {
      throw new Error("exit should not be called")
    },
  })

  assert.equal(status.tools.codex?.authenticated, true)
})

test("ensureAgentCliForOnboarding exits immediately when no agent is authenticated", async () => {
  let exitCode: number | undefined
  let message: string | undefined

  await assert.rejects(
    ensureAgentCliForOnboarding({
      getStatus: async () => ({
        ready: false,
        auth: {
          authenticated: true,
          apiUrl: "https://gentic.example/api/v1",
          maskedApiKey: "tes...-key",
          missing: [],
        },
        agentProviders: ["claude_code", "codex"],
        tools: {
          github: readyTool,
          claude: missingTool,
          codex: { ...readyTool, authenticated: false },
        },
        unmet: ["agent-cli-authenticated"],
      }),
      cancel: (value) => {
        message = value
      },
      exit: (code): never => {
        exitCode = code
        throw new Error("exited")
      },
    }),
    /exited/
  )

  assert.equal(
    message,
    "at least one agent (claude or codex) must be authenticated to run gentic"
  )
  assert.equal(exitCode, 1)
})
