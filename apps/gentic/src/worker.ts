import { rm } from "node:fs/promises"
import { join } from "node:path"
import { setTimeout as sleep } from "node:timers/promises"

import { createAgentApi, type AgentApi, type ClaimedIssue } from "./api.js"
import { buildAttachmentBlocks } from "./attachments.js"
import { loadConfig, type Config } from "./config.js"
import { cloneRepo, getPullRequestUrl, runSetupScript } from "./git.js"
import { logError, logInfo } from "./log.js"
import { setRunState } from "./messages.js"
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

  logInfo(`worker started; polling every ${config.POLL_INTERVAL_MS}ms`)

  while (running) {
    let issue: ClaimedIssue | null = null
    try {
      // Atomically claims the oldest queued issue by flipping it to `cloning`.
      // The conditional update (`run_status = 'queued'`) makes the claim safe
      // if more than one worker is polling.
      issue = await api.claimNextQueuedIssue()
    } catch (error) {
      logError("failed to poll for queued issues:", describe(error))
    }

    if (!issue) {
      await sleep(config.POLL_INTERVAL_MS)
      continue
    }

    await processIssue(api, config, issue)
  }

  logInfo("worker stopped")
}

async function processIssue(
  api: AgentApi,
  config: Config,
  issue: ClaimedIssue
): Promise<void> {
  const dir = join(config.WORKDIR, issue.id)
  // Sibling of the repo clone, not inside it, so downloaded attachments can
  // never end up swept into the commit the agent is instructed to make.
  const attachmentsDir = join(config.WORKDIR, `${issue.id}-attachments`)

  try {
    await rm(attachmentsDir, { recursive: true, force: true })

    await cloneRepo({
      remoteBase: config.GIT_REMOTE_BASE,
      repo: issue.repo,
      dir,
    })

    if (issue.setupScript) {
      await runSetupScript({ script: issue.setupScript, dir })
    }

    await setRunState(api, issue.id, { run_status: "running" })

    // Built fresh each run: images and text files are embedded directly,
    // everything else downloaded into `attachmentsDir` and referenced by
    // path. Attached to the first prompt only.
    const attachmentBlocks = await buildAttachmentBlocks(
      api,
      issue.id,
      attachmentsDir
    )

    // Feed user messages to the session oldest-first. Follow-ups sent while the
    // agent is working are picked up after the current turn; once the transcript
    // is quiet for one poll interval the session ends. When resuming a session
    // that already consumed messages, start the cursor at that run's end so
    // they aren't replayed. A session-less retry (e.g. clone failed before the
    // agent started) has consumed nothing, so it replays from the beginning.
    let cursor =
      issue.sessionId && issue.runFinishedAt
        ? issue.runFinishedAt
        : new Date(0).toISOString()
    let idleChecked = false
    let firstPrompt = true
    const nextPrompt = async (): Promise<PromptTurn | null> => {
      for (;;) {
        const messages = await api.fetchUserMessagesAfter(issue.id, cursor)
        const next = messages[0]
        if (next) {
          idleChecked = false
          cursor = next.created_at
          const content = next.content ?? ""
          if (firstPrompt) {
            firstPrompt = false
            if (attachmentBlocks.length > 0) {
              return [{ type: "text", text: content }, ...attachmentBlocks]
            }
          }
          return content
        }
        if (idleChecked) {
          return null
        }
        idleChecked = true
        await sleep(config.POLL_INTERVAL_MS)
      }
    }

    await runAgentSession({
      api,
      issueId: issue.id,
      agentProvider: issue.agentProvider,
      cwd: dir,
      resumeSessionId: issue.sessionId,
      onSessionId: (sessionId) =>
        setRunState(api, issue.id, { session_id: sessionId }),
      nextPrompt,
    })

    const prUrl = await getPullRequestUrl(dir)
    await setRunState(api, issue.id, {
      run_status: "completed",
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
      await setRunState(api, issue.id, {
        run_status: "held",
        run_error: message,
        run_finished_at: new Date().toISOString(),
        usage_limit_reset_at: usageLimitResetAt,
      }).catch((updateError) => {
        logError("failed to record usage-limit hold:", describe(updateError))
      })
      return
    }

    logError(`issue ${issue.id} failed:`, message)
    await setRunState(api, issue.id, {
      run_status: "failed",
      run_error: message,
      run_finished_at: new Date().toISOString(),
      usage_limit_reset_at: null,
    }).catch((updateError) => {
      logError("failed to record run failure:", describe(updateError))
    })
  }
}

function describe(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}
