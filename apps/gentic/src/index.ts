import "dotenv/config"

import { join } from "node:path"
import { setTimeout as sleep } from "node:timers/promises"

import { createServiceClient } from "@gentic/supabase/service"

import { loadConfig, type Config } from "./config"
import { cloneRepo } from "./git"
import { setRunState, type Supabase } from "./messages"
import { runAgentSession } from "./session"

interface ClaimedIssue {
  id: string
  repo: string
}

async function main(): Promise<void> {
  const config = loadConfig()
  const supabase = createServiceClient()

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
      issue = await claimNextQueuedIssue(supabase)
    } catch (error) {
      console.error("[gentic] failed to poll for queued issues:", describe(error))
    }

    if (!issue) {
      await sleep(config.POLL_INTERVAL_MS)
      continue
    }

    await processIssue(supabase, config, issue)
  }

  console.log("[gentic] worker stopped")
}

/**
 * Atomically claims the oldest queued issue by flipping it to `cloning`. The
 * conditional update (`run_status = 'queued'`) makes the claim safe if more
 * than one worker is polling.
 */
async function claimNextQueuedIssue(
  supabase: Supabase
): Promise<ClaimedIssue | null> {
  const { data: candidate, error: candidateError } = await supabase
    .from("issues")
    .select("id")
    .eq("run_status", "queued")
    .order("updated_at", { ascending: true })
    .limit(1)
    .maybeSingle()

  if (candidateError) {
    throw new Error(candidateError.message)
  }
  if (!candidate) {
    return null
  }

  const now = new Date().toISOString()
  const { data: claimed, error: claimError } = await supabase
    .from("issues")
    .update({
      run_status: "cloning",
      run_started_at: now,
      run_error: null,
      run_finished_at: null,
      updated_at: now,
    })
    .eq("id", (candidate as { id: string }).id)
    .eq("run_status", "queued")
    .select("id, projects(repo)")
    .maybeSingle()

  if (claimError) {
    throw new Error(claimError.message)
  }
  if (!claimed) {
    // Another worker claimed it between the select and the update.
    return null
  }

  return { id: (claimed as { id: string }).id, repo: extractRepo(claimed) }
}

async function processIssue(
  supabase: Supabase,
  config: Config,
  issue: ClaimedIssue
): Promise<void> {
  const dir = join(config.WORKDIR, issue.id)

  try {
    await cloneRepo({
      remoteBase: config.GIT_REMOTE_BASE,
      repo: issue.repo,
      dir,
    })
    await setRunState(supabase, issue.id, { run_status: "running" })

    // Feed user messages to the session oldest-first. Follow-ups sent while the
    // agent is working are picked up after the current turn; once the transcript
    // is quiet for one poll interval the session ends.
    let cursor = new Date(0).toISOString()
    let idleChecked = false
    const nextPrompt = async (): Promise<string | null> => {
      for (;;) {
        const messages = await fetchUserMessagesAfter(supabase, issue.id, cursor)
        const next = messages[0]
        if (next) {
          idleChecked = false
          cursor = next.created_at
          return next.content ?? ""
        }
        if (idleChecked) {
          return null
        }
        idleChecked = true
        await sleep(config.POLL_INTERVAL_MS)
      }
    }

    await runAgentSession({
      supabase,
      issueId: issue.id,
      cwd: dir,
      onSessionId: (sessionId) =>
        setRunState(supabase, issue.id, { session_id: sessionId }),
      nextPrompt,
    })

    await setRunState(supabase, issue.id, {
      run_status: "completed",
      run_finished_at: new Date().toISOString(),
    })
    console.log(`[gentic] issue ${issue.id} completed`)
  } catch (error) {
    const message = describe(error)
    console.error(`[gentic] issue ${issue.id} failed:`, message)
    await setRunState(supabase, issue.id, {
      run_status: "failed",
      run_error: message,
      run_finished_at: new Date().toISOString(),
    }).catch((updateError) => {
      console.error("[gentic] failed to record run failure:", describe(updateError))
    })
  }
}

async function fetchUserMessagesAfter(
  supabase: Supabase,
  issueId: string,
  cursor: string
): Promise<Array<{ content: string | null; created_at: string }>> {
  const { data, error } = await supabase
    .from("messages")
    .select("content, created_at")
    .eq("issue_id", issueId)
    .eq("role", "user")
    .gt("created_at", cursor)
    .order("created_at", { ascending: true })

  if (error) {
    throw new Error(error.message)
  }
  return (data ?? []) as Array<{ content: string | null; created_at: string }>
}

function extractRepo(row: unknown): string {
  const projects = (row as { projects?: unknown }).projects
  const project = Array.isArray(projects) ? projects[0] : projects
  const repo = (project as { repo?: string } | undefined)?.repo
  if (!repo) {
    throw new Error("Issue has no associated project repo")
  }
  return repo
}

function describe(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

main().catch((error) => {
  console.error("[gentic] fatal:", describe(error))
  process.exit(1)
})
