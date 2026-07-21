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

    assert.deepEqual(prompts, ["Initial prompt", "Live middle", "Backlog later"])
    assert.deepEqual(api.acked, [
      { issueId: issue.id, runId: issue.activeRunId, messageIds: ["initial"] },
      { issueId: issue.id, runId: issue.activeRunId, messageIds: ["middle"] },
      { issueId: issue.id, runId: issue.activeRunId, messageIds: ["later"] },
    ])
    assert.deepEqual(
      api.runStates.map((entry) => entry.fields.status ?? entry.fields.session_id),
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
        api.addMessage(issue.id, message("follow-up", "Finish-window prompt", 2))
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
      api.runStates.map((entry) => entry.fields.status ?? entry.fields.session_id),
      ["in-progress", "session-0", "in-progress", "in-progress", "session-1"]
    )
    assert.deepEqual(api.acked.map((entry) => entry.messageIds), [
      ["initial"],
      ["follow-up"],
    ])
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
      GENTIC_API_KEY: "test-key",
      GENTIC_API_URL: "https://gentic.example",
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
    },
    hasLocalCheckout() {
      return false
    },
    async runSetupScript() {},
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
  readonly acked: { issueId: string; runId: string; messageIds: string[] }[] = []
  readonly runStates: { issueId: string; fields: RunStateFields }[] = []
  readonly finishedStatuses: string[] = []
  readonly publishedRunStates: string[] = []
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
    agentProvider: "codex",
    repo: "acme/repo",
    setupScript: null,
    sessionId: null,
    prUrl: null,
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
