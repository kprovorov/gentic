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
import {
  connectIssueChannel,
  type IssueRealtimeChannel,
  type RealtimeUserMessageEvent,
} from "./realtime.js"
import { runAgentSession, type PromptTurn } from "./session.js"
import { getUsageLimitResetAt } from "./usage-limits.js"

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

/** One pending user follow-up, queued for the next prompt turn. */
type QueuedMessage = { id: string; content: string; created_at: string }

async function processIssue(
  api: AgentApi,
  config: Config,
  issue: ClaimedIssue
): Promise<void> {
  const dir = join(config.WORKDIR, issue.id)
  // Sibling of the repo clone, not inside it, so downloaded attachments can
  // never end up swept into the commit the agent is instructed to make.
  const attachmentsDir = join(config.WORKDIR, `${issue.id}-attachments`)

  let channel: IssueRealtimeChannel | null = null

  try {
    // Push queue for user follow-ups, ordered by `created_at`. Fed by two
    // sources deduped by message id: a one-shot REST backlog fetch below,
    // and live `user_message` broadcast events for the rest of the run.
    const seenMessageIds = new Set<string>()
    const queue: QueuedMessage[] = []
    let queueWaiter: (() => void) | null = null

    const enqueue = (message: {
      id: string
      content: string | null
      created_at: string
    }): void => {
      if (seenMessageIds.has(message.id)) {
        return
      }
      seenMessageIds.add(message.id)
      const entry: QueuedMessage = {
        id: message.id,
        content: message.content ?? "",
        created_at: message.created_at,
      }
      const index = queue.findIndex(
        (existing) => existing.created_at > entry.created_at
      )
      if (index === -1) {
        queue.push(entry)
      } else {
        queue.splice(index, 0, entry)
      }
      if (queueWaiter) {
        const resolve = queueWaiter
        queueWaiter = null
        resolve()
      }
    }

    // Join the channel before doing anything else, so no follow-up sent
    // from here on is missed between the seed fetch below and going live.
    // A join failure fails the run like any other startup error — no
    // silent REST fallback in this phase.
    channel = await connectIssueChannel(
      api,
      issue.id,
      (event: RealtimeUserMessageEvent) => enqueue(event)
    )

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
      Boolean(issue.sessionId) && hasLocalCheckout(dir)
    if (!resumingLocalCheckout) {
      await cloneRepo({
        remoteBase: config.GIT_REMOTE_BASE,
        repo: issue.repo,
        dir,
      })

      if (issue.prUrl) {
        await checkoutPullRequest({ prUrl: issue.prUrl, dir })
      }
    }

    if (issue.setupScript) {
      await runSetupScript({ script: issue.setupScript, dir })
    }

    await setRunState(api, channel, issue.id, { status: "in-progress" })

    // Seed the queue with follow-ups sent before the channel connected
    // (including the issue's initial prompt). When resuming a session that
    // already consumed messages, start the cursor at that run's end so they
    // aren't replayed. A session-less retry (e.g. clone failed before the
    // agent started) has consumed nothing, so it replays from the beginning.
    const seedCursor =
      issue.sessionId && issue.runFinishedAt
        ? issue.runFinishedAt
        : new Date(0).toISOString()
    const backlog = await api.fetchUserMessagesAfter(issue.id, seedCursor)
    for (const message of backlog) {
      enqueue(message)
    }

    const waitForQueueOrTimeout = (ms: number): Promise<void> =>
      new Promise((resolve) => {
        const timer = setTimeout(() => {
          queueWaiter = null
          resolve()
        }, ms)
        queueWaiter = () => {
          clearTimeout(timer)
          resolve()
        }
      })

    // Feed user messages to the session oldest-first. Follow-ups pushed while
    // the agent is working are picked up after the current turn; once the
    // transcript is quiet for one poll interval the session ends.
    let idleChecked = false
    const nextPrompt = async (): Promise<PromptTurn | null> => {
      for (;;) {
        const next = queue.shift()
        if (next) {
          idleChecked = false
          const content = next.content
          const attachmentBlocks = await buildAttachmentBlocks(
            api,
            issue.id,
            next.id,
            attachmentsDir
          )
          if (attachmentBlocks.length > 0) {
            return [{ type: "text", text: content }, ...attachmentBlocks]
          }
          return content
        }
        if (idleChecked) {
          return null
        }
        idleChecked = true
        await waitForQueueOrTimeout(config.POLL_INTERVAL_MS)
      }
    }

    await runAgentSession({
      api,
      issueId: issue.id,
      channel,
      agentProvider: issue.agentProvider,
      cwd: dir,
      resumeSessionId: issue.sessionId,
      existingPrUrl: issue.prUrl,
      onSessionId: (sessionId) =>
        setRunState(api, channel, issue.id, { session_id: sessionId }),
      nextPrompt,
    })

    const prUrl = await getPullRequestUrl(dir)
    await setRunState(api, channel, issue.id, {
      status: prUrl ? "ready-for-review" : "waiting-for-input",
      run_finished_at: new Date().toISOString(),
      ...(prUrl ? { pr_url: prUrl } : {}),
    })
    logInfo(`issue ${issue.id} completed`)
  } catch (error) {
    const message = describe(error)
    const usageLimitResetAt = getUsageLimitResetAt(error)
    if (usageLimitResetAt) {
      logInfo(
        `issue ${issue.id} held until ${usageLimitResetAt}: usage limit reached`
      )
      await setRunState(api, channel, issue.id, {
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
    await setRunState(api, channel, issue.id, {
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

function describe(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}
