import assert from "node:assert/strict"
import { chmod, mkdtemp, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { test } from "node:test"

import {
  ensureGithubCliForOnboarding,
  formatOnboardingUnmet,
  getGithubInstallCommand,
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

  assert.equal(exitCode, 1)
})
