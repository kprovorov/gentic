import assert from "node:assert/strict"
import { mkdtemp, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { test } from "node:test"

import type {
  AgentApi,
  ClaimedIssue,
  RunStateFields,
  UserMessage,
} from "../api.js"
import type { Config } from "../config.js"
import type { IssueRealtimeChannel } from "../realtime.js"
import type { PromptDelivery, PromptTurn, RunSessionInput } from "../session.js"
import { processIssue, type ProcessIssueDeps } from "../worker.js"

test("consumes persisted prompts in order, dedupes in-flight fetches, and acks processed messages", async () => {
  await withHarness(async ({ config, issue, api, deps, realtimeWakes }) => {
    api.addMessage(issue.id, message("later", "Backlog later", 3))
    api.addMessage(issue.id, message("initial", "Initial prompt", 1))

    const prompts: PromptTurn[] = []
    deps.runAgentSession = async (input) => {
      await input.onSessionId("session-1")
      prompts.push(await consumePrompt(input))

      api.addMessage(issue.id, message("middle", "Live middle", 2))
      realtimeWakes.get(issue.id)?.()

      prompts.push(await consumePrompt(input))
      prompts.push(await consumePrompt(input))
      assert.equal(await input.nextPrompt(), null)
    }

    await processIssue(api, config, issue, deps)

    assert.deepEqual(prompts, [
      "Initial prompt",
      "Live middle",
      "Backlog later",
    ])
    assert.deepEqual(api.acked, [
      { issueId: issue.id, runId: issue.activeRunId, messageIds: ["initial"] },
      { issueId: issue.id, runId: issue.activeRunId, messageIds: ["middle"] },
      { issueId: issue.id, runId: issue.activeRunId, messageIds: ["later"] },
    ])
    assert.deepEqual(
      api.runStates.map(
        (entry) => entry.fields.status ?? entry.fields.session_id
      ),
      ["in-progress", "session-1"]
    )
    assert.deepEqual(api.finishedStatuses, ["waiting-for-input"])
    assert.equal(api.closedChannels, 1)
  })
})

test("finish-window prompts keep the run open and are processed before final status", async () => {
  await withHarness(async ({ config, issue, api, deps }) => {
    api.addMessage(issue.id, message("initial", "Initial prompt", 1))
    api.finishResults = [false, true]
    api.onFinishAttempt = (attempt) => {
      if (attempt === 1) {
        api.addMessage(
          issue.id,
          message("follow-up", "Finish-window prompt", 2)
        )
      }
    }

    const prompts: PromptTurn[] = []
    deps.runAgentSession = async (input) => {
      await input.onSessionId(`session-${prompts.length}`)
      const first = await input.nextPrompt()
      if (first) {
        prompts.push(normalizeDelivery(first).prompt)
        await input.onPromptProcessed?.(normalizeDelivery(first).messageIds)
      }
      assert.equal(await input.nextPrompt(), null)
    }

    await processIssue(api, config, issue, deps)

    assert.deepEqual(prompts, ["Initial prompt", "Finish-window prompt"])
    assert.deepEqual(api.finishedStatuses, ["waiting-for-input"])
    assert.deepEqual(
      api.runStates.map(
        (entry) => entry.fields.status ?? entry.fields.session_id
      ),
      ["in-progress", "session-0", "in-progress", "in-progress", "session-1"]
    )
    assert.deepEqual(
      api.acked.map((entry) => entry.messageIds),
      [["initial"], ["follow-up"]]
    )
  })
})

test("resumed runs reuse local checkout and existing pull request context", async () => {
  await withHarness(async ({ config, issue, api, deps }) => {
    issue.sessionId = "existing-session"
    issue.prUrl = "https://github.com/acme/repo/pull/5"
    api.addMessage(issue.id, message("follow-up", "Follow-up", 1))
    deps.hasLocalCheckout = () => true

    const prompts: PromptTurn[] = []
    deps.runAgentSession = async (input) => {
      assert.equal(input.resumeSessionId, "existing-session")
      assert.equal(input.existingPrUrl, issue.prUrl)
      assert.equal(input.existingPrCheckedOut, true)
      await input.onSessionId("existing-session")
      prompts.push(await consumePrompt(input))
      assert.equal(await input.nextPrompt(), null)
    }

    await processIssue(api, config, issue, deps)

    assert.deepEqual(prompts, ["Follow-up"])
    assert.equal(api.cloneCalls, 0)
    assert.equal(api.checkoutCalls, 0)
  })
})

test("fresh follow-up continues when previous pull request branch is gone", async () => {
  await withHarness(async ({ config, issue, api, deps }) => {
    issue.sessionId = "existing-session"
    issue.prUrl = "https://github.com/acme/repo/pull/5"
    api.addMessage(issue.id, message("follow-up", "Follow-up", 1))
    deps.checkoutPullRequest = async () => {
      api.checkoutCalls += 1
      return false
    }

    deps.runAgentSession = async (input) => {
      assert.equal(input.resumeSessionId, "existing-session")
      assert.equal(input.existingPrUrl, issue.prUrl)
      assert.equal(input.existingPrCheckedOut, false)
      await input.onSessionId("existing-session")
      assert.equal(await consumePrompt(input), "Follow-up")
      assert.equal(await input.nextPrompt(), null)
    }

    await processIssue(api, config, issue, deps)

    assert.equal(api.cloneCalls, 1)
    assert.equal(api.checkoutCalls, 1)
  })
})

test("concurrent issue runs isolate prompt queues and attachment directories", async () => {
  await withHarness(async ({ config, api, deps }) => {
    const first = claimedIssue("issue-a")
    const second = claimedIssue("issue-b")
    api.addMessage(first.id, message("a-1", "Prompt A", 1))
    api.addMessage(second.id, message("b-1", "Prompt B", 1))

    const entered = barrier(2)
    const promptsByIssue = new Map<string, PromptTurn[]>()
    deps.runAgentSession = async (input) => {
      await entered()
      await input.onSessionId(`session-${input.issueId}`)
      const prompt = await input.nextPrompt()
      assert.ok(prompt)
      const delivery = normalizeDelivery(prompt)
      promptsByIssue.set(input.issueId, [delivery.prompt])
      await input.onPromptProcessed?.(delivery.messageIds)
      assert.equal(await input.nextPrompt(), null)
    }
    deps.buildAttachmentBlocks = async (
      _api,
      issueId,
      messageId,
      attachmentsDir
    ) => {
      api.attachmentDirs.push({ issueId, messageId, attachmentsDir })
      return [
        {
          type: "resource",
          resource: {
            uri: `attachment:///${issueId}.txt`,
            text: `attachment for ${issueId}`,
          },
        },
      ]
    }

    await Promise.all([
      processIssue(api, config, first, deps),
      processIssue(api, config, second, deps),
    ])

    assert.deepEqual(promptsByIssue.get(first.id), [
      [
        { type: "text", text: "Prompt A" },
        {
          type: "resource",
          resource: {
            uri: "attachment:///issue-a.txt",
            text: "attachment for issue-a",
          },
        },
      ],
    ])
    assert.deepEqual(promptsByIssue.get(second.id), [
      [
        { type: "text", text: "Prompt B" },
        {
          type: "resource",
          resource: {
            uri: "attachment:///issue-b.txt",
            text: "attachment for issue-b",
          },
        },
      ],
    ])
    assert.deepEqual(api.attachmentDirs.toSorted(byIssueId), [
      {
        issueId: first.id,
        messageId: "a-1",
        attachmentsDir: join(config.WORKDIR, "issue-a-attachments"),
      },
      {
        issueId: second.id,
        messageId: "b-1",
        attachmentsDir: join(config.WORKDIR, "issue-b-attachments"),
      },
    ])
  })
})

test("unchanged successful work records no unpublished changes and waits for input", async () => {
  await withHarness(async ({ config, issue, api, deps }) => {
    await processIssue(api, config, issue, deps)

    assert.deepEqual(api.unpublishedChanges, [
      {
        issueId: issue.id,
        activeRunId: issue.activeRunId,
        hasUnpublishedAgentChanges: false,
      },
    ])
    assert.deepEqual(api.automaticPrPublishRequests, [])
    assert.deepEqual(api.finishedStatuses, ["waiting-for-input"])
  })
})

test("dirty or untracked work requests automatic publishing and continues the same session", async () => {
  await withHarness(async ({ config, issue, api, deps }) => {
    issue.createPrAutomatically = true
    api.hasChanges = true
    let sessionRuns = 0
    deps.runAgentSession = async (input) => {
      sessionRuns += 1
      await input.onSessionId("session-1")
      const prompt = await input.nextPrompt()
      if (sessionRuns === 1) {
        assert.equal(prompt, null)
        return
      }
      assert.equal(
        normalizeDelivery(prompt!).prompt,
        "Automatic PR publishing is enabled. Please commit any remaining work and open a pull request now."
      )
      await input.onPromptProcessed?.(normalizeDelivery(prompt!).messageIds)
      assert.equal(await input.nextPrompt(), null)
    }

    await processIssue(api, config, issue, deps)

    assert.equal(sessionRuns, 2)
    assert.deepEqual(api.automaticPrPublishRequests, [
      { issueId: issue.id, activeRunId: issue.activeRunId },
    ])
    assert.deepEqual(api.finishedStatuses, ["waiting-for-input"])
    assert.deepEqual(
      api.runStates.map(
        (entry) => entry.fields.status ?? entry.fields.session_id
      ),
      ["in-progress", "session-1", "in-progress", "in-progress", "session-1"]
    )
  })
})

test("agent-created commits are publishable changes", async () => {
  await withHarness(async ({ config, issue, api, deps }) => {
    issue.createPrAutomatically = true
    deps.hasChangesSinceBaseline = async () => true

    await processIssue(api, config, issue, deps)

    assert.deepEqual(
      api.unpublishedChanges.map((entry) => entry.hasUnpublishedAgentChanges),
      [true, true]
    )
    assert.equal(api.automaticPrPublishRequests.length, 1)
  })
})

test("agent-created pull requests are attached without automatic publishing", async () => {
  await withHarness(async ({ config, issue, api, deps }) => {
    issue.createPrAutomatically = true
    api.hasChanges = true
    deps.getPullRequestUrl = async () => "https://github.com/acme/repo/pull/12"

    await processIssue(api, config, issue, deps)

    assert.deepEqual(api.automaticPrPublishRequests, [])
    assert.deepEqual(api.finishedStatuses, ["ready-for-review"])
    assert.deepEqual(api.unpublishedChanges, [
      {
        issueId: issue.id,
        activeRunId: issue.activeRunId,
        hasUnpublishedAgentChanges: false,
      },
    ])
  })
})

test("pre-existing pull requests skip automatic publishing", async () => {
  await withHarness(async ({ config, issue, api, deps }) => {
    issue.createPrAutomatically = true
    issue.prUrl = "https://github.com/acme/repo/pull/5"
    api.hasChanges = true

    await processIssue(api, config, issue, deps)

    assert.deepEqual(api.automaticPrPublishRequests, [])
    assert.deepEqual(api.finishedStatuses, ["ready-for-review"])
    assert.deepEqual(api.unpublishedChanges, [
      {
        issueId: issue.id,
        activeRunId: issue.activeRunId,
        hasUnpublishedAgentChanges: false,
      },
    ])
  })
})

test("automatic publishing attempts at most once per active run", async () => {
  await withHarness(async ({ config, issue, api, deps }) => {
    issue.createPrAutomatically = true
    api.hasChanges = true

    await processIssue(api, config, issue, deps)

    assert.equal(api.automaticPrPublishRequests.length, 1)
    assert.deepEqual(api.finishedStatuses, ["waiting-for-input"])
  })
})

test("a later run may retry automatic publishing", async () => {
  await withHarness(async ({ config, issue, api, deps }) => {
    issue.createPrAutomatically = true
    api.hasChanges = true
    api.automaticPrPublishError = new Error("publish API down")

    await processIssue(api, config, issue, deps)
    await processIssue(
      api,
      config,
      { ...issue, activeRunId: `${issue.id}-next-run` },
      deps
    )

    assert.deepEqual(api.automaticPrPublishRequests, [
      { issueId: issue.id, activeRunId: issue.activeRunId },
      { issueId: issue.id, activeRunId: `${issue.id}-next-run` },
    ])
    assert.deepEqual(api.finishedStatuses, [
      "waiting-for-input",
      "waiting-for-input",
    ])
  })
})

test("automatic publishing request failures finish waiting without looping", async () => {
  await withHarness(async ({ config, issue, api, deps }) => {
    issue.createPrAutomatically = true
    api.hasChanges = true
    api.automaticPrPublishError = new Error("request failed")

    await processIssue(api, config, issue, deps)

    assert.equal(api.automaticPrPublishRequests.length, 1)
    assert.deepEqual(api.finishedStatuses, ["waiting-for-input"])
  })
})

test("unpublished-change record failures do not fail completed turns", async () => {
  await withHarness(async ({ config, issue, api, deps }) => {
    issue.createPrAutomatically = true
    api.hasChanges = true
    api.recordUnpublishedChangesError = new Error("bookkeeping unavailable")

    await processIssue(api, config, issue, deps)

    assert.equal(api.automaticPrPublishRequests.length, 1)
    assert.deepEqual(api.finishedStatuses, ["waiting-for-input"])
  })
})

test("usage limits do not trigger automatic publishing", async () => {
  await withHarness(async ({ config, issue, api, deps }) => {
    issue.createPrAutomatically = true
    api.hasChanges = true
    deps.runAgentSession = async () => {
      throw new Error("Claude Code usage limit reached. Try again in 2 hours.")
    }

    await processIssue(api, config, issue, deps)

    assert.deepEqual(api.unpublishedChanges, [])
    assert.deepEqual(api.automaticPrPublishRequests, [])
    assert.deepEqual(
      api.runStates.map((entry) => entry.fields.status),
      ["in-progress", "held"]
    )
  })
})

test("run failures do not trigger automatic publishing", async () => {
  await withHarness(async ({ config, issue, api, deps }) => {
    issue.createPrAutomatically = true
    api.hasChanges = true
    deps.runAgentSession = async () => {
      throw new Error("agent failed")
    }

    await processIssue(api, config, issue, deps)

    assert.deepEqual(api.unpublishedChanges, [])
    assert.deepEqual(api.automaticPrPublishRequests, [])
    assert.deepEqual(
      api.runStates.map((entry) => entry.fields.status),
      ["in-progress", "run-failed"]
    )
  })
})

test("worker restarts do not loop when the active run already has an automatic request", async () => {
  await withHarness(async ({ config, issue, api, deps }) => {
    issue.createPrAutomatically = true
    issue.hasUnpublishedAgentChanges = true
    api.hasChanges = true
    api.automaticPrPublishCreated = false

    await processIssue(api, config, issue, deps)

    assert.equal(api.automaticPrPublishRequests.length, 1)
    assert.deepEqual(api.finishedStatuses, ["waiting-for-input"])
  })
})

test("publishes ready-for-review status when automatic publishing creates a PR", async () => {
  await withHarness(async ({ config, issue, api, deps }) => {
    issue.createPrAutomatically = true
    api.hasChanges = true
    let sessionRuns = 0
    deps.runAgentSession = async (input) => {
      sessionRuns += 1
      await input.onSessionId("session-1")
      const next = await input.nextPrompt()
      if (next) {
        await input.onPromptProcessed?.(normalizeDelivery(next).messageIds)
      }
      assert.equal(await input.nextPrompt(), null)
    }
    deps.getPullRequestUrl = async () =>
      sessionRuns >= 2 ? "https://github.com/acme/repo/pull/44" : null

    await processIssue(api, config, issue, deps)

    assert.deepEqual(api.finishedStatuses, ["ready-for-review"])
    assert.deepEqual(api.publishedRunStates.at(-1), "ready-for-review")
  })
})

async function withHarness(
  run: (harness: {
    config: Config
    issue: ClaimedIssue
    api: FakeApi
    deps: ProcessIssueDeps
    realtimeWakes: Map<string, () => void>
  }) => Promise<void>
): Promise<void> {
  const workdir = await mkdtemp(join(tmpdir(), "gentic-worker-test-"))
  try {
    const config: Config = {
      GENTIC_WORKER_ID: "worker-1",
      GENTIC_WORKER_CREDENTIAL: "test-key",
      GENTIC_API_URL: "https://gentic.example",
      GENTIC_WORKER_SETUP_STATE: "ready",
      GIT_REMOTE_BASE: "git@github.com:",
      WORKDIR: workdir,
      POLL_INTERVAL_MS: 1,
      MAX_CONCURRENT_ISSUES: 2,
    }
    const api = new FakeApi()
    const realtimeWakes = new Map<string, () => void>()
    const deps = fakeDeps(api, realtimeWakes)
    const issue = claimedIssue("issue-1")

    await run({ config, issue, api, deps, realtimeWakes })
  } finally {
    await rm(workdir, { recursive: true, force: true })
  }
}

function fakeDeps(
  api: FakeApi,
  realtimeWakes: Map<string, () => void>
): ProcessIssueDeps {
  return {
    async connectIssueChannel(_api, issueId, onUserMessage) {
      realtimeWakes.set(issueId, onUserMessage)
      return fakeChannel(api)
    },
    async cloneRepo() {
      api.cloneCalls += 1
    },
    async checkoutPullRequest() {
      api.checkoutCalls += 1
      return true
    },
    hasLocalCheckout() {
      return false
    },
    async runSetupScript() {},
    async captureRepoBaseline() {
      return { headSha: "baseline", worktreeFingerprint: "clean" }
    },
    async hasChangesSinceBaseline() {
      return api.hasChanges
    },
    async setRunState(agentApi, _channel, issueId, fields) {
      await agentApi.setRunState(issueId, fields)
    },
    async buildAttachmentBlocks() {
      return []
    },
    async runAgentSession(input) {
      await input.onSessionId(`session-${input.issueId}`)
      for (;;) {
        const next = await input.nextPrompt()
        if (!next) {
          return
        }
        await input.onPromptProcessed?.(normalizeDelivery(next).messageIds)
      }
    },
    async getPullRequestUrl() {
      return null
    },
  }
}

function fakeChannel(api: FakeApi): IssueRealtimeChannel {
  return {
    async publishMessage() {},
    async publishRunState(event) {
      api.publishedRunStates.push(event.status)
    },
    async close() {
      api.closedChannels += 1
    },
  }
}

class FakeApi implements AgentApi {
  readonly messages = new Map<string, UserMessage[]>()
  readonly ackedIds = new Map<string, Set<string>>()
  readonly acked: { issueId: string; runId: string; messageIds: string[] }[] =
    []
  readonly runStates: { issueId: string; fields: RunStateFields }[] = []
  readonly finishedStatuses: string[] = []
  readonly publishedRunStates: string[] = []
  readonly unpublishedChanges: {
    issueId: string
    activeRunId: string
    hasUnpublishedAgentChanges: boolean
  }[] = []
  readonly automaticPrPublishRequests: {
    issueId: string
    activeRunId: string
  }[] = []
  readonly attachmentDirs: {
    issueId: string
    messageId: string
    attachmentsDir: string
  }[] = []
  finishResults: boolean[] = [true]
  onFinishAttempt: ((attempt: number) => void) | null = null
  private finishAttempts = 0
  cloneCalls = 0
  checkoutCalls = 0
  closedChannels = 0
  hasChanges = false
  automaticPrPublishCreated = true
  automaticPrPublishError: Error | null = null
  recordUnpublishedChangesError: Error | null = null

  addMessage(issueId: string, message: UserMessage): void {
    this.messages.set(issueId, [...(this.messages.get(issueId) ?? []), message])
  }

  async claimNextQueuedIssue(): Promise<ClaimedIssue | null> {
    return null
  }

  async setRunState(issueId: string, fields: RunStateFields): Promise<void> {
    this.runStates.push({ issueId, fields })
  }

  async finishRun(
    _issueId: string,
    fields: RunStateFields & {
      active_run_id: string
      status: "ready-for-review" | "waiting-for-input"
      run_finished_at: string
    }
  ): Promise<{ finished: boolean; status: typeof fields.status }> {
    this.finishAttempts += 1
    this.onFinishAttempt?.(this.finishAttempts)
    const result = this.finishResults.shift() ?? true
    if (result) {
      this.finishedStatuses.push(fields.status)
    }
    return { finished: result, status: fields.status }
  }

  async insertMessage(): Promise<string> {
    return "message-id"
  }

  async fetchPendingUserMessages(issueId: string): Promise<UserMessage[]> {
    const acked = this.ackedIds.get(issueId) ?? new Set<string>()
    return (this.messages.get(issueId) ?? [])
      .filter((entry) => !acked.has(entry.id))
      .sort((left, right) => left.seq - right.seq)
  }

  async ackUserMessages(
    issueId: string,
    runId: string,
    messageIds: string[]
  ): Promise<void> {
    const acked = this.ackedIds.get(issueId) ?? new Set<string>()
    for (const id of messageIds) {
      acked.add(id)
    }
    this.ackedIds.set(issueId, acked)
    this.acked.push({ issueId, runId, messageIds })
  }

  async recordUnpublishedAgentChanges(
    issueId: string,
    fields: {
      active_run_id: string
      has_unpublished_agent_changes: boolean
    }
  ): Promise<void> {
    if (this.recordUnpublishedChangesError) {
      throw this.recordUnpublishedChangesError
    }
    this.unpublishedChanges.push({
      issueId,
      activeRunId: fields.active_run_id,
      hasUnpublishedAgentChanges: fields.has_unpublished_agent_changes,
    })
  }

  async requestAutomaticPrPublish(
    issueId: string,
    activeRunId: string
  ): Promise<{
    requestId: string
    messageId: string
    created: boolean
    status: "pending"
    issue: {
      id: string
      code: string
      title: string | null
      activeRunId: string
      createPrAutomatically: boolean
      hasUnpublishedAgentChanges: boolean
      prUrl: string | null
    }
  }> {
    this.automaticPrPublishRequests.push({ issueId, activeRunId })
    if (this.automaticPrPublishError) {
      throw this.automaticPrPublishError
    }
    if (this.automaticPrPublishCreated) {
      this.addMessage(
        issueId,
        message(
          `auto-pr-${this.automaticPrPublishRequests.length}`,
          "Automatic PR publishing is enabled. Please commit any remaining work and open a pull request now.",
          this.automaticPrPublishRequests.length + 100
        )
      )
    }
    return {
      requestId: "request-1",
      messageId: "message-1",
      created: this.automaticPrPublishCreated,
      status: "pending",
      issue: {
        id: issueId,
        code: "TEST-1",
        title: null,
        activeRunId,
        createPrAutomatically: true,
        hasUnpublishedAgentChanges: true,
        prUrl: null,
      },
    }
  }

  async fetchAttachments() {
    return []
  }

  async fetchRealtimeToken() {
    return {
      url: "https://example.supabase.co",
      apiKey: "publishable",
      token: "token",
      expiresAt: new Date(Date.now() + 60_000).toISOString(),
    }
  }
}

async function consumePrompt(input: RunSessionInput): Promise<PromptTurn> {
  const next = await input.nextPrompt()
  assert.ok(next)
  const delivery = normalizeDelivery(next)
  await input.onPromptProcessed?.(delivery.messageIds)
  return delivery.prompt
}

function normalizeDelivery(next: PromptTurn | PromptDelivery): PromptDelivery {
  if (typeof next === "object" && !Array.isArray(next) && "prompt" in next) {
    return next
  }
  return { prompt: next, messageIds: [] }
}

function claimedIssue(id: string): ClaimedIssue {
  return {
    id,
    activeRunId: `${id}-run`,
    code: `TEST-${id}`,
    title: null,
    agentProvider: "codex",
    issueModel: null,
    repo: "acme/repo",
    setupScript: null,
    sessionId: null,
    prUrl: null,
    createPrAutomatically: false,
    hasUnpublishedAgentChanges: false,
  }
}

function message(id: string, content: string, seq: number): UserMessage {
  return {
    id,
    content,
    seq,
    created_at: new Date(seq).toISOString(),
  }
}

function byIssueId(
  left: { issueId: string },
  right: { issueId: string }
): number {
  return left.issueId.localeCompare(right.issueId)
}

function barrier(count: number): () => Promise<void> {
  let waiting = 0
  let resolveAll: (() => void) | null = null
  const ready = new Promise<void>((resolve) => {
    resolveAll = resolve
  })

  return async () => {
    waiting += 1
    if (waiting === count) {
      resolveAll?.()
    }
    await ready
  }
}
