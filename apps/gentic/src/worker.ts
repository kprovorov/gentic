import { rm } from "node:fs/promises"
import { arch, platform } from "node:os"
import { join } from "node:path"
import { setTimeout as sleep } from "node:timers/promises"

import packageJson from "../package.json" with { type: "json" }
import { createAgentApi, type AgentApi, type ClaimedIssue } from "./api.js"
import { buildAttachmentBlocks } from "./attachments.js"
import { loadConfig, type Config } from "./config.js"
import {
  captureRepoBaseline,
  checkoutPullRequest,
  cloneRepo,
  getPullRequestUrl,
  hasChangesSinceBaseline,
  hasLocalCheckout,
  type RepoBaseline,
  runSetupScript,
} from "./git.js"
import { logError, logInfo } from "./log.js"
import { setRunState } from "./messages.js"
import { createPendingMessagePromptSource } from "./pending-messages.js"
import { connectIssueChannel, type IssueRealtimeChannel } from "./realtime.js"
import {
  isSessionCancelled,
  runAgentSession,
  throwIfAborted,
} from "./session.js"
import { getToolStatuses, type ToolStatuses } from "./tools.js"
import { describeAgentError, getUsageLimitResetAt } from "./usage-limits.js"
import type {
  WorkerCapabilities,
  WorkerControlResponse,
  WorkerProviderCapability,
  WorkerHeartbeatTelemetry,
} from "@gentic/validators/workers"

export const HEARTBEAT_INTERVAL_MS = 30_000
export const CONTROL_INTERVAL_MS = 10_000
export const PROVIDER_CHECK_CACHE_MS = 5 * 60_000

export interface ProcessIssueDeps {
  connectIssueChannel: typeof connectIssueChannel
  cloneRepo: typeof cloneRepo
  checkoutPullRequest: typeof checkoutPullRequest
  hasLocalCheckout: typeof hasLocalCheckout
  runSetupScript: typeof runSetupScript
  captureRepoBaseline: typeof captureRepoBaseline
  hasChangesSinceBaseline: typeof hasChangesSinceBaseline
  setRunState: typeof setRunState
  buildAttachmentBlocks: typeof buildAttachmentBlocks
  runAgentSession: typeof runAgentSession
  getPullRequestUrl: typeof getPullRequestUrl
}

export interface WorkerLoopDeps extends ProcessIssueDeps {
  sleep: (ms: number) => Promise<void>
  now: () => Date
  getToolStatuses: () => Promise<ToolStatuses>
  loadConfig: () => Config
}

const defaultProcessIssueDeps: ProcessIssueDeps = {
  connectIssueChannel,
  cloneRepo,
  checkoutPullRequest,
  hasLocalCheckout,
  runSetupScript,
  captureRepoBaseline,
  hasChangesSinceBaseline,
  setRunState,
  buildAttachmentBlocks,
  runAgentSession,
  getPullRequestUrl,
}

const defaultWorkerLoopDeps: WorkerLoopDeps = {
  ...defaultProcessIssueDeps,
  sleep,
  now: () => new Date(),
  getToolStatuses,
  loadConfig,
}

const RESTART_ONLY_CONFIG_KEYS = [
  "GENTIC_WORKER_ID",
  "GENTIC_WORKER_CREDENTIAL",
  "GENTIC_API_URL",
] as const satisfies readonly (keyof Config)[]

export function applyReloadedConfig(
  current: Config,
  next: Config
): (keyof Config)[] {
  const restartRequired = RESTART_ONLY_CONFIG_KEYS.filter(
    (key) => current[key] !== next[key]
  )
  const connection = Object.fromEntries(
    RESTART_ONLY_CONFIG_KEYS.map((key) => [key, current[key]])
  ) as Pick<Config, (typeof RESTART_ONLY_CONFIG_KEYS)[number]>

  Object.assign(current, next, connection)
  return restartRequired
}

export async function runWorker(): Promise<void> {
  const config = loadConfig()
  const api = createAgentApi({
    apiUrl: config.GENTIC_API_URL,
    apiKey: config.GENTIC_WORKER_CREDENTIAL,
  })

  await runWorkerLoop(api, config, defaultWorkerLoopDeps)
}

export async function runWorkerLoop(
  api: AgentApi,
  config: Config,
  deps: WorkerLoopDeps = defaultWorkerLoopDeps
): Promise<void> {
  let running = true
  let offlineMarked = false
  let offlinePending: Promise<void> | null = null
  let stoppedByControl = false
  const activeRuns = new Map<
    Promise<void>,
    { issueId: string; activeRunId: string; controller: AbortController }
  >()
  const stop = (): void => {
    running = false
    abortActiveRuns(activeRuns)
    if (!stoppedByControl && !offlineMarked) {
      offlineMarked = true
      offlinePending = api.markOffline().catch((error) => {
        logError("failed to mark worker offline:", describe(error))
      })
    }
  }
  const reload = (): void => {
    try {
      const restartRequired = applyReloadedConfig(config, deps.loadConfig())
      logInfo(
        `worker config reloaded; polling every ${config.POLL_INTERVAL_MS}ms with up to ${config.MAX_CONCURRENT_ISSUES} concurrent issues`
      )
      if (restartRequired.length > 0) {
        logInfo(
          `worker connection settings require a restart and were not reloaded: ${restartRequired.join(", ")}`
        )
      }
    } catch (error) {
      logError("failed to reload worker config; keeping current config:", describe(error))
    }
  }
  process.on("SIGINT", stop)
  process.on("SIGTERM", stop)
  process.on("SIGHUP", reload)

  logInfo(
    `worker started; polling every ${config.POLL_INTERVAL_MS}ms with up to ${config.MAX_CONCURRENT_ISSUES} concurrent issues`
  )

  const telemetry = createTelemetrySource(config, deps)
  let nextHeartbeatAt = 0
  let nextControlAt = 0

  const sendHeartbeat = async (): Promise<void> => {
    try {
      await api.sendHeartbeat(await telemetry.snapshot())
    } catch (error) {
      logError("worker heartbeat failed:", describe(error))
    }
  }

  const pollControl = async (): Promise<void> => {
    let control: WorkerControlResponse
    try {
      control = await api.fetchWorkerControl()
    } catch (error) {
      logError("worker control check failed:", describe(error))
      return
    }

    if (control.worker.banned) {
      stoppedByControl = true
      running = false
      abortActiveRuns(activeRuns)
      return
    }

    const validRuns = new Map(
      control.runs.map((run) => [run.issue_id, run.active_run_id])
    )
    for (const run of activeRuns.values()) {
      if (validRuns.get(run.issueId) !== run.activeRunId) {
        run.controller.abort()
      }
    }
  }

  while (running) {
    const nowMs = deps.now().getTime()
    if (nowMs >= nextHeartbeatAt) {
      await sendHeartbeat()
      nextHeartbeatAt = nowMs + HEARTBEAT_INTERVAL_MS
    }
    if (nowMs >= nextControlAt) {
      await pollControl()
      nextControlAt = nowMs + CONTROL_INTERVAL_MS
      if (!running) {
        break
      }
    }

    if (!running) {
      break
    }

    if (activeRuns.size >= config.MAX_CONCURRENT_ISSUES) {
      // Wake promptly when a run frees a slot, but periodically re-check the
      // stop flag when every slot remains occupied.
      await Promise.race([
        Promise.race(activeRuns.keys()),
        sleepUntilNextTick(
          deps,
          config.POLL_INTERVAL_MS,
          nextHeartbeatAt,
          nextControlAt
        ),
      ])
      continue
    }

    let issue: ClaimedIssue | null = null
    if (!running) {
      break
    }
    try {
      // Atomically claims the highest-priority eligible issue by flipping it
      // to `queued`. The conditional update keeps the claim safe if more
      // than one worker is polling or a held issue becomes ineligible.
      issue = await api.claimNextQueuedIssue()
    } catch (error) {
      logError("failed to poll for queued issues:", describe(error))
    }

    if (!issue) {
      await sleepUntilNextTick(
        deps,
        config.POLL_INTERVAL_MS,
        nextHeartbeatAt,
        nextControlAt
      )
      continue
    }

    const controller = new AbortController()
    const run = processIssue(api, config, issue, deps, {
      signal: controller.signal,
    })
      .catch((error) => {
        if (isSessionCancelled(error)) {
          logInfo(`issue ${issue.id} cancelled by worker control`)
          return
        }
        // processIssue records ordinary failures itself. This protects the
        // pool from an unexpected failure in its cleanup path.
        logError(`issue ${issue.id} ended unexpectedly:`, describe(error))
      })
      .finally(() => {
        activeRuns.delete(run)
      })
    activeRuns.set(run, {
      issueId: issue.id,
      activeRunId: issue.activeRunId,
      controller,
    })
    logInfo(
      `issue ${issue.id} started (${activeRuns.size}/${config.MAX_CONCURRENT_ISSUES} active)`
    )
  }

  if (!stoppedByControl && !offlineMarked) {
    offlineMarked = true
    offlinePending = api.markOffline().catch((error) => {
      logError("failed to mark worker offline:", describe(error))
    })
    await offlinePending
  } else if (offlinePending) {
    await offlinePending
  }

  if (activeRuns.size > 0) {
    abortActiveRuns(activeRuns)
    logInfo(`waiting for ${activeRuns.size} active issue run(s) to finish`)
    await Promise.all(activeRuns.keys())
  }

  process.off("SIGINT", stop)
  process.off("SIGTERM", stop)
  process.off("SIGHUP", reload)
  logInfo("worker stopped")
}

export async function processIssue(
  api: AgentApi,
  config: Config,
  issue: ClaimedIssue,
  deps: ProcessIssueDeps = defaultProcessIssueDeps,
  options: {
    signal?: AbortSignal
  } = {},
  state: { automaticPrAttemptedRunIds: Set<string> } = {
    automaticPrAttemptedRunIds: new Set(),
  }
): Promise<void> {
  const dir = join(config.WORKDIR, issue.id)
  // Sibling of the repo clone, not inside it, so downloaded attachments can
  // never end up swept into the commit the agent is instructed to make.
  const attachmentsDir = join(config.WORKDIR, `${issue.id}-attachments`)

  let channel: IssueRealtimeChannel | null = null
  let currentSessionId = issue.sessionId

  try {
    throwIfAborted(options.signal)
    const promptSource = createPendingMessagePromptSource({
      api,
      issueId: issue.id,
      runId: issue.activeRunId,
      pollIntervalMs: config.POLL_INTERVAL_MS,
      buildPrompt: async (message) => {
        const attachmentBlocks = await deps.buildAttachmentBlocks(
          api,
          issue.id,
          issue.activeRunId,
          message.id,
          attachmentsDir
        )
        if (attachmentBlocks.length > 0) {
          return [{ type: "text", text: message.content }, ...attachmentBlocks]
        }
        return message.content
      },
      onFetchError: (error) => {
        logError(
          `failed to fetch pending messages for issue ${issue.id}:`,
          describe(error)
        )
      },
    })

    channel = await deps
      .connectIssueChannel(api, issue.id, issue.activeRunId, promptSource.wake)
      .catch((error) => {
        logError(
          `issue ${issue.id} realtime unavailable; continuing with database polling:`,
          describe(error)
        )
        return createNoopIssueChannel()
      })

    throwIfAborted(options.signal)
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
    let existingPrCheckedOut = resumingLocalCheckout && Boolean(issue.prUrl)
    if (!resumingLocalCheckout) {
      await deps.cloneRepo({
        remoteBase: config.GIT_REMOTE_BASE,
        repo: issue.repo,
        dir,
      })

      if (issue.prUrl) {
        existingPrCheckedOut = await deps.checkoutPullRequest({
          prUrl: issue.prUrl,
          dir,
        })
        if (!existingPrCheckedOut) {
          logInfo(
            `issue ${issue.id} previous pull request branch could not be checked out; agent will create a new pull request if changes are needed`
          )
        }
      }
    }

    if (issue.setupScript) {
      await deps.runSetupScript({ script: issue.setupScript, dir })
    }

    throwIfAborted(options.signal)
    const baseline = await deps.captureRepoBaseline(dir)

    await deps.setRunState(api, channel, issue.id, issue.activeRunId, {
      status: "in-progress",
    })

    await deps.runAgentSession({
      api,
      issueId: issue.id,
      activeRunId: issue.activeRunId,
      channel,
      agentProvider: issue.agentProvider,
      issueModel: issue.issueModel,
      cwd: dir,
      // Every managed session — fresh or resumed — talks to the owner's
      // Gentic MCP endpoint with this worker's own credential. No preflight:
      // an unreachable endpoint surfaces through the normal run-failed path.
      genticMcp: {
        apiUrl: config.GENTIC_API_URL,
        credential: config.GENTIC_WORKER_CREDENTIAL,
      },
      resumeSessionId: issue.sessionId,
      existingPrUrl: issue.prUrl,
      existingPrCheckedOut,
      onSessionId: (sessionId) => {
        currentSessionId = sessionId
        return deps.setRunState(
          api,
          channel,
          issue.id,
          issue.activeRunId,
          {
            session_id: sessionId,
          }
        )
      },
      onPromptProcessed: promptSource.onPromptProcessed,
      nextPrompt: promptSource.nextPrompt,
      signal: options.signal,
    })

    throwIfAborted(options.signal)
    const turnResult = await recordCompletedTurnState({
      api,
      deps,
      issue,
      dir,
      baseline,
    })
    const prUrl = turnResult.prUrl

    if (
      await shouldContinueWithAutomaticPrPublish({
        api,
        issue,
        turnResult,
        attemptedRunIds: state.automaticPrAttemptedRunIds,
      })
    ) {
      await deps.setRunState(api, channel, issue.id, issue.activeRunId, {
        status: "in-progress",
      })
      await processIssue(
        api,
        config,
        {
          ...issue,
          sessionId: currentSessionId,
          prUrl: null,
          hasUnpublishedAgentChanges: true,
        },
        deps,
        options,
        state
      )
      return
    }

    const { finished, status: finishedStatus } = await api.finishRun(issue.id, {
      active_run_id: issue.activeRunId,
      status: prUrl ? "ready-for-review" : "waiting-for-input",
      run_finished_at: new Date().toISOString(),
      ...(prUrl ? { pr_url: prUrl } : {}),
    })
    if (!finished) {
      logInfo(
        `issue ${issue.id} received more prompts before finish; re-queueing`
      )
      await deps.setRunState(api, channel, issue.id, issue.activeRunId, {
        status: "in-progress",
      })
      await processIssue(
        api,
        config,
        {
          ...issue,
          sessionId: currentSessionId,
          prUrl,
          hasUnpublishedAgentChanges: turnResult.hasUnpublishedAgentChanges,
        },
        deps,
        options,
        state
      )
      return
    }
    if (channel) {
      throwIfAborted(options.signal)
      await channel.publishRunState({
        status: finishedStatus,
        pr_url: prUrl ?? null,
        usage_limit_reset_at: null,
        run_error: null,
      })
    }
    logInfo(`issue ${issue.id} completed`)
  } catch (error) {
    if (options.signal?.aborted || isSessionCancelled(error)) {
      throw error
    }
    const message = describeAgentError(error)
    const usageLimitResetAt = getUsageLimitResetAt(error)
    if (usageLimitResetAt) {
      logInfo(
        `issue ${issue.id} held until ${usageLimitResetAt}: usage limit reached`
      )
      await deps
        .setRunState(api, channel, issue.id, issue.activeRunId, {
          status: "held",
          run_error: message,
          run_finished_at: new Date().toISOString(),
          usage_limit_reset_at: usageLimitResetAt,
        })
        .catch((updateError) => {
          logError("failed to record usage-limit hold:", describe(updateError))
        })
      return
    }

    logError(`issue ${issue.id} failed:`, message)
    await deps
      .setRunState(api, channel, issue.id, issue.activeRunId, {
        status: "run-failed",
        run_error: message,
        run_finished_at: new Date().toISOString(),
        usage_limit_reset_at: null,
      })
      .catch((updateError) => {
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

function abortActiveRuns(
  activeRuns: Map<
    Promise<void>,
    { issueId: string; activeRunId: string; controller: AbortController }
  >
): void {
  for (const run of activeRuns.values()) {
    run.controller.abort()
  }
}

function sleepUntilNextTick(
  deps: Pick<WorkerLoopDeps, "sleep" | "now">,
  pollIntervalMs: number,
  nextHeartbeatAt: number,
  nextControlAt: number
): Promise<void> {
  const nowMs = deps.now().getTime()
  const nextInterval = Math.max(
    1,
    Math.min(pollIntervalMs, nextHeartbeatAt - nowMs, nextControlAt - nowMs)
  )
  return deps.sleep(nextInterval)
}

function createTelemetrySource(
  config: Config,
  deps: Pick<WorkerLoopDeps, "getToolStatuses" | "now">
): {
  snapshot: () => Promise<WorkerHeartbeatTelemetry>
} {
  const processStartedAt = deps.now().toISOString()
  let cached:
    | {
        expiresAt: number
        value: WorkerCapabilities
      }
    | null = null

  return {
    async snapshot() {
      const nowMs = deps.now().getTime()
      if (!cached || nowMs >= cached.expiresAt) {
        try {
          cached = {
            expiresAt: nowMs + PROVIDER_CHECK_CACHE_MS,
            value: providerCapabilities(await deps.getToolStatuses()),
          }
        } catch (error) {
          logError("provider capability check failed:", describe(error))
          cached = {
            expiresAt: nowMs + PROVIDER_CHECK_CACHE_MS,
            value: cached?.value ?? { providers: {} },
          }
        }
      }

      return {
        process_started_at: processStartedAt,
        gentic_version: packageJson.version,
        os: platform(),
        arch: arch(),
        configured_capacity: config.MAX_CONCURRENT_ISSUES,
        setup_completed: config.GENTIC_WORKER_SETUP_STATE === "ready",
        provider_capabilities: cached.value,
        last_seen_at: deps.now().toISOString(),
      }
    },
  }
}

function providerCapabilities(tools: ToolStatuses): WorkerCapabilities {
  return {
    providers: {
      claude_code: toolCapability(tools.claude),
      codex: toolCapability(tools.codex),
    },
  }
}

function toolCapability(
  status: ToolStatuses["claude"]
): WorkerProviderCapability {
  return {
    enabled: status !== undefined,
    available: status?.installed ?? false,
    authenticated: status?.authenticated ?? null,
    version: status?.version ?? null,
    models: [],
    metadata: {},
  }
}

type CompletedTurnState = {
  prUrl: string | null
  hasPublishableChanges: boolean
  hasUnpublishedAgentChanges: boolean
}

async function recordCompletedTurnState(input: {
  api: AgentApi
  deps: Pick<ProcessIssueDeps, "getPullRequestUrl" | "hasChangesSinceBaseline">
  issue: ClaimedIssue
  dir: string
  baseline: RepoBaseline
}): Promise<CompletedTurnState> {
  const prUrl =
    (await input.deps.getPullRequestUrl(input.dir)) ?? input.issue.prUrl
  const hasPublishableChanges = await input.deps.hasChangesSinceBaseline(
    input.dir,
    input.baseline
  )
  const hasUnpublishedAgentChanges = !prUrl && hasPublishableChanges

  await input.api
    .recordUnpublishedAgentChanges(input.issue.id, {
      active_run_id: input.issue.activeRunId,
      has_unpublished_agent_changes: hasUnpublishedAgentChanges,
    })
    .catch((error) => {
      logError(
        `issue ${input.issue.id} failed to record unpublished changes:`,
        describe(error)
      )
    })

  return {
    prUrl,
    hasPublishableChanges,
    hasUnpublishedAgentChanges,
  }
}

async function shouldContinueWithAutomaticPrPublish(input: {
  api: AgentApi
  issue: ClaimedIssue
  turnResult: CompletedTurnState
  attemptedRunIds: Set<string>
}): Promise<boolean> {
  if (
    !input.turnResult.hasUnpublishedAgentChanges ||
    !input.issue.createPrAutomatically ||
    input.attemptedRunIds.has(input.issue.activeRunId)
  ) {
    return false
  }

  input.attemptedRunIds.add(input.issue.activeRunId)

  try {
    const result = await input.api.requestAutomaticPrPublish(
      input.issue.id,
      input.issue.activeRunId
    )
    return result.created
  } catch (error) {
    logError(
      `issue ${input.issue.id} automatic pull request request failed:`,
      describe(error)
    )
    return false
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
