import "dotenv/config"

import { join } from "node:path"
import { setTimeout as sleep } from "node:timers/promises"

import { createAgentApi, type AgentApi, type ClaimedIssue } from "./api"
import { buildAttachmentBlocks } from "./attachments"
import { loadConfig, type Config } from "./config"
import { cloneRepo } from "./git"
import { setRunState } from "./messages"
import { runAgentSession, type PromptTurn } from "./session"

async function main(): Promise<void> {
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

  console.log(`[gentic] worker started; polling every ${config.POLL_INTERVAL_MS}ms`)

  while (running) {
    let issue: ClaimedIssue | null = null
    try {
      issue = await claimNextQueuedIssue(api)
    } catch (error) {
      console.error("[gentic] failed to poll for queued issues:", describe(error))
    }

    if (!issue) {
      await sleep(config.POLL_INTERVAL_MS)
      continue
    }

    await processIssue(api, config, issue)
  }

  console.log("[gentic] worker stopped")
}

/**
 * Atomically claims the oldest queued issue by flipping it to `cloning`. The
 * conditional update (`run_status = 'queued'`) makes the claim safe if more
 * than one worker is polling.
 */
async function claimNextQueuedIssue(api: AgentApi): Promise<ClaimedIssue | null> {
  return await api.claimNextQueuedIssue()
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
    await cloneRepo({
      remoteBase: config.GIT_REMOTE_BASE,
      repo: issue.repo,
      dir,
    })
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
        const messages = await fetchUserMessagesAfter(api, issue.id, cursor)
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
      cwd: dir,
      resumeSessionId: issue.sessionId,
      onSessionId: (sessionId) =>
        setRunState(api, issue.id, { session_id: sessionId }),
      nextPrompt,
    })

    await setRunState(api, issue.id, {
      run_status: "completed",
      run_finished_at: new Date().toISOString(),
    })
    console.log(`[gentic] issue ${issue.id} completed`)
  } catch (error) {
    const message = describe(error)
    console.error(`[gentic] issue ${issue.id} failed:`, message)
    await setRunState(api, issue.id, {
      run_status: "failed",
      run_error: message,
      run_finished_at: new Date().toISOString(),
    }).catch((updateError) => {
      console.error("[gentic] failed to record run failure:", describe(updateError))
    })
  }
}

async function fetchUserMessagesAfter(
  api: AgentApi,
  issueId: string,
  cursor: string
): Promise<Array<{ content: string | null; created_at: string }>> {
  return await api.fetchUserMessagesAfter(issueId, cursor)
}

function describe(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

main().catch((error) => {
  console.error("[gentic] fatal:", describe(error))
  process.exit(1)
})
