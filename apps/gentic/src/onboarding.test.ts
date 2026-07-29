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

test("getOnboardingStatus reports ready when credentials, gh, and all agents are authenticated", async () => {
  const status = await getOnboardingStatus({
    configInput: {
      GENTIC_WORKER_ID: "worker-1",
      GENTIC_WORKER_CREDENTIAL: "test-key",
      GENTIC_API_URL: "https://gentic.example/api/v1",
      GENTIC_WORKER_SETUP_STATE: "ready",
    },
    getTools: async (): Promise<ToolStatuses> => ({
      github: readyTool,
      claude: readyTool,
      codex: readyTool,
    }),
  })

  assert.equal(status.ready, true)
  assert.deepEqual(status.unmet, [])
  assert.deepEqual(status.agentProviders, ["claude_code", "codex"])
})

test("getOnboardingStatus reports unmet credentials, github auth, and agent auth", async () => {
  const status = await getOnboardingStatus({
    configInput: {
      GENTIC_API_URL: "https://gentic.example/api/v1",
    },
    getTools: async (): Promise<ToolStatuses> => ({
      github: { ...readyTool, authenticated: false },
      claude: readyTool,
      codex: { ...readyTool, authenticated: false },
    }),
  })

  assert.equal(status.ready, false)
  assert.deepEqual(status.unmet, [
    "gentic-auth",
    "github-cli-authenticated",
    "agent-cli-authenticated",
  ])
  assert.deepEqual(status.auth.missing, [
    "GENTIC_WORKER_ID",
    "GENTIC_WORKER_CREDENTIAL",
  ])
  assert.ok(
    formatOnboardingUnmet(status).some((line) =>
      line.includes("missing GENTIC_WORKER_ID and GENTIC_WORKER_CREDENTIAL")
    )
  )
})

test("getOnboardingStatus reports agent install when any agent CLI is missing", async () => {
  const status = await getOnboardingStatus({
    configInput: {
      GENTIC_WORKER_ID: "worker-1",
      GENTIC_WORKER_CREDENTIAL: "test-key",
      GENTIC_API_URL: "https://gentic.example/api/v1",
      GENTIC_WORKER_SETUP_STATE: "ready",
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
      workerId: authenticated ? "worker-1" : undefined,
      apiUrl: authenticated ? "https://gentic.example/api/v1" : undefined,
      maskedWorkerCredential: authenticated ? "tes...-key" : undefined,
      setupState: authenticated ? "ready" : undefined,
      missing: authenticated
        ? []
        : ["GENTIC_WORKER_ID", "GENTIC_WORKER_CREDENTIAL", "GENTIC_API_URL"],
    },
    agentProviders: ["claude_code", "codex"],
    tools: {
      github: readyTool,
      claude: readyTool,
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

function defaultRunOnboardingDeps(status: OnboardingStatus) {
  return {
    setupAgentCLIs: async () => true,
    ensureAgentCli: async () => status,
  }
}

test("runOnboarding shows welcome and skips auth prompt when already authenticated", async () => {
  const { messages, ui } = createUiRecorder()
  const status = makeStatus(true)

  await runOnboarding({
    ...defaultRunOnboardingDeps(status),
    getStatus: async () => status,
    confirm: async () => false,
    ui,
  })

  assert.equal(messages[0], "intro:Welcome to Gentic")
  assert.ok(
    messages.includes(
      `info:Step 1/${ONBOARDING_STEPS.length}: Gentic auth`
    )
  )
  assert.ok(
    messages.some((message) =>
      message.startsWith("success:Gentic worker connected")
    )
  )
})

test("runOnboarding tells the user to connect first when registration is missing", async () => {
  const { messages, ui } = createUiRecorder()
  const status = makeStatus(false)

  await runOnboarding({
    ...defaultRunOnboardingDeps(status),
    getStatus: async () => status,
    confirm: async () => false,
    ui,
  })

  assert.ok(
    messages.includes("warn:No Gentic worker is connected. Run `gentic worker connect <code>`.")
  )
  assert.ok(
    messages.some((message) => message.includes("gentic worker connect <code>"))
  )
  assert.equal(messages.at(-1), "outro:Connect this worker first.")
})

test("runOnboarding prints ready summary and starts worker when confirmed", async () => {
  const { messages, ui } = createUiRecorder()
  const prompts: string[] = []
  let startCalls = 0
  const status = makeStatus(true)

  await runOnboarding({
    ...defaultRunOnboardingDeps(status),
    getStatus: async () => status,
    confirm: async ({ message }) => {
      prompts.push(message)
      return true
    },
    startWorker: async () => {
      startCalls += 1
      return true
    },
    ui,
  })

  assert.deepEqual(prompts, ["Enable the gentic worker now?"])
  assert.equal(startCalls, 1)
  assert.ok(messages.includes("info:Gentic auth: connected (worker-1, tes...-key, https://gentic.example/api/v1)"))
  assert.ok(messages.includes("info:GitHub CLI: installed, authenticated"))
  assert.ok(
    messages.includes(
      "info:Agent CLI: Claude installed, authenticated, Codex installed, authenticated"
    )
  )
})

test("runOnboarding prints gentic start instructions when worker enable is declined", async () => {
  const { messages, ui } = createUiRecorder()
  let startCalls = 0
  const status = makeStatus(true)

  await runOnboarding({
    ...defaultRunOnboardingDeps(status),
    getStatus: async () => status,
    confirm: async () => false,
    startWorker: async () => {
      startCalls += 1
      return true
    },
    ui,
  })

  assert.equal(startCalls, 0)
  assert.ok(messages.includes("info:Run `gentic start` later to enable the worker."))
  assert.equal(messages.at(-1), "outro:Onboarding checks complete.")
})

test("runOnboarding resumes setup-incomplete registration without another code", async () => {
  const { messages, ui } = createUiRecorder()
  let markReadyCalls = 0
  let startCalls = 0
  const status: OnboardingStatus = {
    ...makeStatus(true),
    ready: false,
    auth: {
      ...makeStatus(true).auth,
      setupState: "setup-incomplete",
    },
    unmet: ["worker-setup-incomplete"],
  }

  await runOnboarding({
    ...defaultRunOnboardingDeps(status),
    getStatus: async () => status,
    markWorkerReady: async () => {
      markReadyCalls += 1
    },
    confirm: async () => false,
    startWorker: async () => {
      startCalls += 1
      return true
    },
    ui,
  })

  assert.equal(markReadyCalls, 1)
  assert.equal(startCalls, 0)
  assert.ok(
    messages.includes(`info:Step 4/${ONBOARDING_STEPS.length}: Worker service`)
  )
  assert.equal(messages.at(-1), "outro:Onboarding checks complete.")
})

test("runOnboarding exits immediately when required gh setup declines", async () => {
  const { messages, ui } = createUiRecorder()
  const missingGithubStatus: OnboardingStatus = {
    ...makeStatus(true),
    tools: {
      github: missingTool,
      codex: readyTool,
    },
    unmet: ["github-cli-installed"],
    ready: false,
  }
  let workerCalls = 0

  await assert.rejects(
    runOnboarding({
      getStatus: async () => missingGithubStatus,
      ensureGithubCli: async () => {
        throw new Error("exited")
      },
      startWorker: async () => {
        workerCalls += 1
        return true
      },
      ui,
    }),
    /exited/
  )

  assert.equal(workerCalls, 0)
  assert.ok(
    !messages.includes(`info:Step 3/${ONBOARDING_STEPS.length}: Agent CLI`)
  )
  assert.ok(
    !messages.includes(`info:Step 4/${ONBOARDING_STEPS.length}: Worker service`)
  )
})

test("runOnboarding exits immediately when an agent is not authenticated", async () => {
  const { messages, ui } = createUiRecorder()
  const unauthenticatedAgentStatus: OnboardingStatus = {
    ...makeStatus(true),
    tools: {
      github: readyTool,
      claude: readyTool,
      codex: { ...readyTool, authenticated: false },
    },
    unmet: ["agent-cli-authenticated"],
    ready: false,
  }
  let workerCalls = 0

  await assert.rejects(
    runOnboarding({
      getStatus: async () => unauthenticatedAgentStatus,
      setupAgentCLIs: async () => true,
      ensureAgentCli: async () => {
        throw new Error("exited")
      },
      startWorker: async () => {
        workerCalls += 1
        return true
      },
      ui,
    }),
    /exited/
  )

  assert.equal(workerCalls, 0)
  assert.ok(
    !messages.includes(`info:Step 4/${ONBOARDING_STEPS.length}: Worker service`)
  )
  assert.ok(
    !messages.some((message) => message.startsWith("info:Gentic auth:"))
  )
})

test("runOnboarding errors when agent setups are declined", async () => {
  const { messages, ui } = createUiRecorder()
  const noAgentStatus: OnboardingStatus = {
    ...makeStatus(true),
    agentProviders: ["claude_code", "codex"],
    tools: {
      github: readyTool,
      claude: missingTool,
      codex: missingTool,
    },
    unmet: ["agent-cli-installed"],
    ready: false,
  }
  let setupCalls = 0
  let exitCode: number | undefined
  let cancelMessage: string | undefined

  await assert.rejects(
    runOnboarding({
      getStatus: async () => noAgentStatus,
      setupAgentCLIs: async (tools) => {
        setupCalls += 1
        assert.deepEqual(tools, noAgentStatus.tools)
        return true
      },
      ensureAgentCli: async () =>
        ensureAgentCliForOnboarding({
          getStatus: async () => noAgentStatus,
          cancel: (message) => {
            cancelMessage = message
          },
          exit: (code): never => {
            exitCode = code
            throw new Error("exited")
          },
        }),
      ui,
    }),
    /exited/
  )

  assert.equal(setupCalls, 1)
  assert.equal(exitCode, 1)
  assert.equal(
    cancelMessage,
    "both Claude Code and Codex must be installed and authenticated to run gentic"
  )
  assert.ok(
    !messages.includes(`info:Step 4/${ONBOARDING_STEPS.length}: Worker service`)
  )
})

test("runOnboarding passes when all agent setups are accepted", async () => {
  const { messages, ui } = createUiRecorder()
  const initialStatus: OnboardingStatus = {
    ...makeStatus(true),
    agentProviders: ["claude_code", "codex"],
    tools: {
      github: readyTool,
      claude: missingTool,
      codex: missingTool,
    },
    unmet: ["agent-cli-installed"],
    ready: false,
  }
  const allAgentsReadyStatus: OnboardingStatus = {
    ...initialStatus,
    tools: {
      github: readyTool,
      claude: readyTool,
      codex: readyTool,
    },
    unmet: [],
    ready: true,
  }
  let workerCalls = 0

  await runOnboarding({
    getStatus: async () => initialStatus,
    setupAgentCLIs: async (tools) => {
      assert.deepEqual(tools, initialStatus.tools)
      return true
    },
    ensureAgentCli: async () => allAgentsReadyStatus,
    confirm: async () => true,
    startWorker: async () => {
      workerCalls += 1
      return true
    },
    ui,
  })

  assert.equal(workerCalls, 1)
  assert.ok(
    messages.includes("success:Claude Code, Codex has an authenticated CLI.")
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
        maskedWorkerCredential: "tes...-key",
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

test("ensureAgentCliForOnboarding exits immediately when any agent is not authenticated", async () => {
  let exitCode: number | undefined
  let message: string | undefined

  await assert.rejects(
    ensureAgentCliForOnboarding({
      getStatus: async () => ({
        ready: false,
        auth: {
          authenticated: true,
          apiUrl: "https://gentic.example/api/v1",
          maskedWorkerCredential: "tes...-key",
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
    "both Claude Code and Codex must be installed and authenticated to run gentic"
  )
  assert.equal(exitCode, 1)
})
