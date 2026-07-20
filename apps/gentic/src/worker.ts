import { rm } from "node:fs/promises"
import { join } from "node:path"
import { setTimeout as sleep } from "node:timers/promises"

import { createAgentApi, type AgentApi, type ClaimedIssue } from "./api.js"
import { buildAttachmentBlocks } from "./attachments.js"
import { loadConfig, type Config } from "./config.js"
import {
  checkoutPullRequest,
  cloneRepo,
  getPullRequestUrl,
  hasLocalCheckout,
  runSetupScript,
} from "./git.js"
import { logError, logInfo } from "./log.js"
import { setRunState } from "./messages.js"
import { createPendingMessagePromptSource } from "./pending-messages.js"
import {
  connectIssueChannel,
  type IssueRealtimeChannel,
} from "./realtime.js"
import { runAgentSession } from "./session.js"
import { getUsageLimitResetAt } from "./usage-limits.js"

export interface ProcessIssueDeps {
  connectIssueChannel: typeof connectIssueChannel
  cloneRepo: typeof cloneRepo
  checkoutPullRequest: typeof checkoutPullRequest
  hasLocalCheckout: typeof hasLocalCheckout
  runSetupScript: typeof runSetupScript
  setRunState: typeof setRunState
  buildAttachmentBlocks: typeof buildAttachmentBlocks
  runAgentSession: typeof runAgentSession
  getPullRequestUrl: typeof getPullRequestUrl
}

const defaultProcessIssueDeps: ProcessIssueDeps = {
  connectIssueChannel,
  cloneRepo,
  checkoutPullRequest,
  hasLocalCheckout,
  runSetupScript,
  setRunState,
  buildAttachmentBlocks,
  runAgentSession,
  getPullRequestUrl,
}

export async function runWorker(): Promise<void> {
  const config = loadConfig()
  const api = createAgentApi({
    apiUrl: config.GENTIC_API_URL,
    apiKey: config.GENTIC_API_KEY,
  })

  let running = true
  const stop = (): void => {
    running = false
  }
  process.on("SIGINT", stop)
  process.on("SIGTERM", stop)

  logInfo(
    `worker started; polling every ${config.POLL_INTERVAL_MS}ms with up to ${config.MAX_CONCURRENT_ISSUES} concurrent issues`
  )

  const activeRuns = new Set<Promise<void>>()

  while (running) {
    if (activeRuns.size >= config.MAX_CONCURRENT_ISSUES) {
      // Wake promptly when a run frees a slot, but periodically re-check the
      // stop flag when every slot remains occupied.
      await Promise.race([Promise.race(activeRuns), sleep(config.POLL_INTERVAL_MS)])
      continue
    }

    let issue: ClaimedIssue | null = null
    try {
      // Atomically claims the oldest todo issue by flipping it to `queued`.
      // The conditional update (`status = 'todo'`) makes the claim safe
      // if more than one worker is polling.
      issue = await api.claimNextQueuedIssue()
    } catch (error) {
      logError("failed to poll for queued issues:", describe(error))
    }

    if (!issue) {
      await sleep(config.POLL_INTERVAL_MS)
      continue
    }

    const run = processIssue(api, config, issue)
      .catch((error) => {
        // processIssue records ordinary failures itself. This protects the
        // pool from an unexpected failure in its cleanup path.
        logError(`issue ${issue.id} ended unexpectedly:`, describe(error))
      })
      .finally(() => {
        activeRuns.delete(run)
      })
    activeRuns.add(run)
    logInfo(
      `issue ${issue.id} started (${activeRuns.size}/${config.MAX_CONCURRENT_ISSUES} active)`
    )
  }

  if (activeRuns.size > 0) {
    logInfo(`waiting for ${activeRuns.size} active issue run(s) to finish`)
    await Promise.all(activeRuns)
  }

  logInfo("worker stopped")
}

export async function processIssue(
  api: AgentApi,
  config: Config,
  issue: ClaimedIssue,
  deps: ProcessIssueDeps = defaultProcessIssueDeps
): Promise<void> {
  const dir = join(config.WORKDIR, issue.id)
  // Sibling of the repo clone, not inside it, so downloaded attachments can
  // never end up swept into the commit the agent is instructed to make.
  const attachmentsDir = join(config.WORKDIR, `${issue.id}-attachments`)

  let channel: IssueRealtimeChannel | null = null
  let currentSessionId = issue.sessionId

  try {
    const promptSource = createPendingMessagePromptSource({
      api,
      issueId: issue.id,
      runId: issue.activeRunId,
      pollIntervalMs: config.POLL_INTERVAL_MS,
      buildPrompt: async (content) => {
        const attachmentBlocks = await deps.buildAttachmentBlocks(
          api,
          issue.id,
          attachmentsDir
        )
        if (attachmentBlocks.length > 0) {
          return [{ type: "text", text: content }, ...attachmentBlocks]
        }
        return content
      },
      onFetchError: (error) => {
        logError(
          `failed to fetch pending messages for issue ${issue.id}:`,
          describe(error)
        )
      },
    })

    channel = await deps.connectIssueChannel(
      api,
      issue.id,
      promptSource.wake
    ).catch((error) => {
      logError(
        `issue ${issue.id} realtime unavailable; continuing with database polling:`,
        describe(error)
      )
      return createNoopIssueChannel()
    })

    await rm(attachmentsDir, { recursive: true, force: true })

    // A follow-up message resumes `issue.sessionId`'s ACP conversation. If
    // this same worker already has that issue's repo checked out from the
    // run that session belongs to, keep it as-is rather than wiping it —
    // otherwise any local commits (or uncommitted work) the agent left
    // between turns are destroyed and the follow-up effectively starts over
    // in a brand new workspace. A fresh clone only happens for a genuinely
    // new run (no session yet) or when no local checkout survived (e.g. a
    // different worker machine claimed this follow-up).
    const resumingLocalCheckout =
      Boolean(issue.sessionId) && deps.hasLocalCheckout(dir)
    if (!resumingLocalCheckout) {
      await deps.cloneRepo({
        remoteBase: config.GIT_REMOTE_BASE,
        repo: issue.repo,
        dir,
      })

      if (issue.prUrl) {
        await deps.checkoutPullRequest({ prUrl: issue.prUrl, dir })
      }
    }

    if (issue.setupScript) {
      await deps.runSetupScript({ script: issue.setupScript, dir })
    }

    await deps.setRunState(api, channel, issue.id, { status: "in-progress" })

    await deps.runAgentSession({
      api,
      issueId: issue.id,
      channel,
      agentProvider: issue.agentProvider,
      cwd: dir,
      resumeSessionId: issue.sessionId,
      existingPrUrl: issue.prUrl,
      onSessionId: (sessionId) => {
        currentSessionId = sessionId
        return deps.setRunState(api, channel, issue.id, {
          session_id: sessionId,
        })
      },
      onPromptProcessed: promptSource.onPromptProcessed,
      nextPrompt: promptSource.nextPrompt,
    })

    const prUrl = await deps.getPullRequestUrl(dir)
    const finished = await api.finishRun(issue.id, {
      active_run_id: issue.activeRunId,
      status: prUrl ? "ready-for-review" : "waiting-for-input",
      run_finished_at: new Date().toISOString(),
      ...(prUrl ? { pr_url: prUrl } : {}),
    })
    if (!finished) {
      logInfo(
        `issue ${issue.id} received more prompts before finish; re-queueing`
      )
      await deps.setRunState(api, channel, issue.id, { status: "in-progress" })
      await processIssue(
        api,
        config,
        {
          ...issue,
          sessionId: currentSessionId,
          prUrl,
        },
        deps
      )
      return
    }
    if (channel) {
      await channel.publishRunState({
        status: prUrl ? "ready-for-review" : "waiting-for-input",
        pr_url: prUrl ?? null,
        usage_limit_reset_at: null,
        run_error: null,
      })
    }
    logInfo(`issue ${issue.id} completed`)
  } catch (error) {
    const message = describe(error)
    const usageLimitResetAt = getUsageLimitResetAt(error)
    if (usageLimitResetAt) {
      logInfo(
        `issue ${issue.id} held until ${usageLimitResetAt}: usage limit reached`
      )
      await deps.setRunState(api, channel, issue.id, {
        status: "held",
        run_error: message,
        run_finished_at: new Date().toISOString(),
        usage_limit_reset_at: usageLimitResetAt,
      }).catch((updateError) => {
        logError("failed to record usage-limit hold:", describe(updateError))
      })
      return
    }

    logError(`issue ${issue.id} failed:`, message)
    await deps.setRunState(api, channel, issue.id, {
      status: "run-failed",
      run_error: message,
      run_finished_at: new Date().toISOString(),
      usage_limit_reset_at: null,
    }).catch((updateError) => {
      logError("failed to record run failure:", describe(updateError))
    })
  } finally {
    if (channel) {
      await channel.close().catch((closeError) => {
        logError("failed to close realtime channel:", describe(closeError))
      })
    }
  }
}

function createNoopIssueChannel(): IssueRealtimeChannel {
  return {
    async publishMessage() {},
    async publishRunState() {},
    async close() {},
  }
}

function describe(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}
