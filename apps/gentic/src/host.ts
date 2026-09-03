import { rm } from "node:fs/promises"
import { arch, platform } from "node:os"
import { join } from "node:path"
import { setTimeout as sleep } from "node:timers/promises"

import packageJson from "../package.json" with { type: "json" }
import {
  createAgentApi,
  type AgentApi,
  type ClaimedIssue,
  type ClaimedReviewRun,
} from "./api.js"
import { buildAttachmentBlocks } from "./attachments.js"
import { loadConfig, type Config } from "./config.js"
import {
  captureRepoBaseline,
  checkoutIssueBranch,
  cloneRepo,
  cloneRepoAtSha,
  diffAgainstBase,
  hasChangesSinceBaseline,
  hasLocalCheckout,
  type RepoBaseline,
  runSetupScript,
  verifyHeadSha,
} from "./git.js"
import { logError, logInfo } from "./log.js"
import { setRunState } from "./messages.js"
import { createPendingMessagePromptSource } from "./pending-messages.js"
import { connectIssueChannel, type IssueRealtimeChannel } from "./realtime.js"
import {
  connectReviewRunChannel,
  type ReviewRunRealtimeChannel,
} from "./review-run-realtime.js"
import { runReviewerSession } from "./review-session.js"
import {
  isSessionCancelled,
  runAgentSession,
  throwIfAborted,
} from "./session.js"
import { createSkillInstallRunner } from "./skill-installs.js"
import { getToolStatuses, type ToolStatuses } from "./tools.js"
import { describeAgentError, getUsageLimitResetAt } from "./usage-limits.js"
import type {
  HostCapabilities,
  HostControlResponse,
  HostProviderCapability,
  HostHeartbeatTelemetry,
} from "@gentic/validators/hosts"

export const HEARTBEAT_INTERVAL_MS = 30_000
export const CONTROL_INTERVAL_MS = 10_000
export const PROVIDER_CHECK_CACHE_MS = 5 * 60_000

export interface ProcessIssueDeps {
  connectIssueChannel: typeof connectIssueChannel
  cloneRepo: typeof cloneRepo
  checkoutIssueBranch: typeof checkoutIssueBranch
  hasLocalCheckout: typeof hasLocalCheckout
  runSetupScript: typeof runSetupScript
  captureRepoBaseline: typeof captureRepoBaseline
  hasChangesSinceBaseline: typeof hasChangesSinceBaseline
  setRunState: typeof setRunState
  buildAttachmentBlocks: typeof buildAttachmentBlocks
  runAgentSession: typeof runAgentSession
}

export interface ProcessReviewRunDeps {
  connectReviewRunChannel: typeof connectReviewRunChannel
  cloneRepoAtSha: typeof cloneRepoAtSha
  verifyHeadSha: typeof verifyHeadSha
  diffAgainstBase: typeof diffAgainstBase
  runReviewerSession: typeof runReviewerSession
}

export interface HostLoopDeps extends ProcessIssueDeps, ProcessReviewRunDeps {
  sleep: (ms: number) => Promise<void>
  now: () => Date
  getToolStatuses: () => Promise<ToolStatuses>
  loadConfig: () => Config
  createSkillInstallRunner: typeof createSkillInstallRunner
}

const defaultProcessIssueDeps: ProcessIssueDeps = {
  connectIssueChannel,
  cloneRepo,
  checkoutIssueBranch,
  hasLocalCheckout,
  runSetupScript,
  captureRepoBaseline,
  hasChangesSinceBaseline,
  setRunState,
  buildAttachmentBlocks,
  runAgentSession,
}

const defaultProcessReviewRunDeps: ProcessReviewRunDeps = {
  connectReviewRunChannel,
  cloneRepoAtSha,
  verifyHeadSha,
  diffAgainstBase,
  runReviewerSession,
}

const defaultHostLoopDeps: HostLoopDeps = {
  ...defaultProcessIssueDeps,
  ...defaultProcessReviewRunDeps,
  sleep,
  now: () => new Date(),
  getToolStatuses,
  loadConfig,
  createSkillInstallRunner,
}

const RESTART_ONLY_CONFIG_KEYS = [
  "GENTIC_HOST_ID",
  "GENTIC_HOST_CREDENTIAL",
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

export async function runHost(): Promise<void> {
  const config = loadConfig()
  const api = createAgentApi({
    apiUrl: config.GENTIC_API_URL,
    apiKey: config.GENTIC_HOST_CREDENTIAL,
  })

  await runHostLoop(api, config, defaultHostLoopDeps)
}

export async function runHostLoop(
  api: AgentApi,
  config: Config,
  deps: HostLoopDeps = defaultHostLoopDeps
): Promise<void> {
  let running = true
  let offlineMarked = false
  let offlinePending: Promise<void> | null = null
  let stoppedByControl = false
  const activeRuns = new Map<
    Promise<void>,
    { issueId: string; activeRunId: string; controller: AbortController }
  >()
  // Tracked separately from `activeRuns` because review jobs are a distinct
  // process launch from implementation issues (GEN-414), but both maps count
  // against the same `MAX_CONCURRENT_ISSUES` capacity and are drained
  // together on shutdown.
  const activeReviewRuns = new Map<
    Promise<void>,
    { reviewRunId: string; controller: AbortController }
  >()
  const stop = (): void => {
    running = false
    abortActiveRuns(activeRuns)
    abortActiveRuns(activeReviewRuns)
    if (!stoppedByControl && !offlineMarked) {
      offlineMarked = true
      offlinePending = api.markOffline().catch((error) => {
        logError("failed to mark host offline:", describe(error))
      })
    }
  }
  const reload = (): void => {
    try {
      const restartRequired = applyReloadedConfig(config, deps.loadConfig())
      logInfo(
        `host config reloaded; polling every ${config.POLL_INTERVAL_MS}ms with up to ${config.MAX_CONCURRENT_ISSUES} concurrent issues`
      )
      if (restartRequired.length > 0) {
        logInfo(
          `host connection settings require a restart and were not reloaded: ${restartRequired.join(", ")}`
        )
      }
    } catch (error) {
      logError(
        "failed to reload host config; keeping current config:",
        describe(error)
      )
    }
  }
  process.on("SIGINT", stop)
  process.on("SIGTERM", stop)
  process.on("SIGHUP", reload)

  logInfo(
    `host started; polling every ${config.POLL_INTERVAL_MS}ms with up to ${config.MAX_CONCURRENT_ISSUES} concurrent issues`
  )

  const telemetry = createTelemetrySource(config, deps)
  const skillInstalls = deps.createSkillInstallRunner(api)
  let nextHeartbeatAt = 0
  let nextControlAt = 0

  const sendHeartbeat = async (): Promise<void> => {
    try {
      await api.sendHeartbeat(await telemetry.snapshot())
    } catch (error) {
      logError("host heartbeat failed:", describe(error))
    }
  }

  const pollControl = async (): Promise<void> => {
    let control: HostControlResponse
    try {
      control = await api.fetchHostControl()
    } catch (error) {
      logError("host control check failed:", describe(error))
      return
    }

    if (control.host.banned) {
      stoppedByControl = true
      running = false
      abortActiveRuns(activeRuns)
      abortActiveRuns(activeReviewRuns)
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

    // A review run leaving `running` server-side (PR closed/draft, new head
    // SHA, human changes-requested, or a completed/failed verdict) is how a
    // cancellation reaches a host holding the claim — every relevant
    // GitHub webhook already drives that transition (GEN-413).
    const validReviewRunIds = new Set(
      control.review_runs
        .filter((run) => run.status === "running")
        .map((run) => run.review_run_id)
    )
    for (const run of activeReviewRuns.values()) {
      if (!validReviewRunIds.has(run.reviewRunId)) {
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
      // Starts the install in the background: skill installation shares the
      // control tick but never a run slot, so issue claiming continues.
      await skillInstalls.poll()
    }

    if (!running) {
      break
    }

    if (
      activeRuns.size + activeReviewRuns.size >=
      config.MAX_CONCURRENT_ISSUES
    ) {
      // Wake promptly when a run frees a slot, but periodically re-check the
      // stop flag when every slot remains occupied.
      await Promise.race([
        Promise.race([...activeRuns.keys(), ...activeReviewRuns.keys()]),
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
      // than one host is polling or a held issue becomes ineligible.
      issue = await api.claimNextQueuedIssue()
    } catch (error) {
      logError("failed to poll for queued issues:", describe(error))
    }

    if (issue) {
      const controller = new AbortController()
      const run = processIssue(api, config, issue, deps, {
        signal: controller.signal,
      })
        .catch((error) => {
          if (isSessionCancelled(error)) {
            logInfo(`issue ${issue.id} cancelled by host control`)
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
        `issue ${issue.id} started (${activeRuns.size + activeReviewRuns.size}/${config.MAX_CONCURRENT_ISSUES} active)`
      )
      continue
    }

    // Implementation work always wins capacity contention (GEN-414): a
    // review job is only claimed once no implementation issue was available
    // for this host, re-evaluated on every poll tick rather than just once
    // at cold start.
    let reviewRun: ClaimedReviewRun | null = null
    if (!running) {
      break
    }
    try {
      reviewRun = await api.claimReviewRun()
    } catch (error) {
      logError("failed to poll for review runs:", describe(error))
    }

    if (!reviewRun) {
      await sleepUntilNextTick(
        deps,
        config.POLL_INTERVAL_MS,
        nextHeartbeatAt,
        nextControlAt
      )
      continue
    }

    const reviewController = new AbortController()
    const reviewRunPromise = processReviewRun(api, config, reviewRun, deps, {
      signal: reviewController.signal,
    })
      .catch((error) => {
        if (isSessionCancelled(error)) {
          logInfo(`review run ${reviewRun.id} cancelled by host control`)
          return
        }
        logError(
          `review run ${reviewRun.id} ended unexpectedly:`,
          describe(error)
        )
      })
      .finally(() => {
        activeReviewRuns.delete(reviewRunPromise)
      })
    activeReviewRuns.set(reviewRunPromise, {
      reviewRunId: reviewRun.id,
      controller: reviewController,
    })
    logInfo(
      `review run ${reviewRun.id} started (${activeRuns.size + activeReviewRuns.size}/${config.MAX_CONCURRENT_ISSUES} active)`
    )
  }

  if (!stoppedByControl && !offlineMarked) {
    offlineMarked = true
    offlinePending = api.markOffline().catch((error) => {
      logError("failed to mark host offline:", describe(error))
    })
    await offlinePending
  } else if (offlinePending) {
    await offlinePending
  }

  if (activeRuns.size > 0 || activeReviewRuns.size > 0) {
    abortActiveRuns(activeRuns)
    abortActiveRuns(activeReviewRuns)
    logInfo(
      `waiting for ${activeRuns.size} active issue run(s) and ${activeReviewRuns.size} active review run(s) to finish`
    )
    await Promise.all([...activeRuns.keys(), ...activeReviewRuns.keys()])
  }

  // An accepted install is attempted once and never retried, so let it report
  // its result rather than abandoning it half-finished on shutdown.
  await skillInstalls.drain()

  process.off("SIGINT", stop)
  process.off("SIGTERM", stop)
  process.off("SIGHUP", reload)
  logInfo("host stopped")
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
  let issueAttachmentsDelivered = false

  try {
    throwIfAborted(options.signal)
    const promptSource = createPendingMessagePromptSource({
      api,
      issueId: issue.id,
      runId: issue.activeRunId,
      pollIntervalMs: config.POLL_INTERVAL_MS,
      buildPrompt: async (message) => {
        // The issue's own attachments are handed to the agent once per run, on
        // its first prompt: they outlive resets, so a new session has to see
        // them again, but re-sending them every follow-up turn would just
        // re-upload the same bytes.
        const includeIssueAttachments = !issueAttachmentsDelivered
        issueAttachmentsDelivered = true
        const attachmentBlocks = await deps.buildAttachmentBlocks(
          api,
          issue.id,
          issue.activeRunId,
          message.id,
          attachmentsDir,
          { includeIssueAttachments }
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
    // this same host already has that issue's repo checked out from the
    // run that session belongs to, keep it as-is rather than wiping it —
    // otherwise any local commits (or uncommitted work) the agent left
    // between turns are destroyed and the follow-up effectively starts over
    // in a brand new workspace. A fresh clone only happens for a genuinely
    // new run (no session yet) or when no local checkout survived (e.g. a
    // a different host claimed this follow-up).
    const resumingLocalCheckout =
      Boolean(issue.sessionId) && deps.hasLocalCheckout(dir)
    if (!resumingLocalCheckout) {
      await deps.cloneRepo({
        remoteBase: config.GIT_REMOTE_BASE,
        repo: issue.repo,
        dir,
      })

      await deps.checkoutIssueBranch({ branchName: issue.branchName, dir })
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
      // Gentic MCP endpoint with this host's own credential. No preflight:
      // an unreachable endpoint surfaces through the normal run-failed path.
      genticMcp: {
        apiUrl: config.GENTIC_API_URL,
        credential: config.GENTIC_HOST_CREDENTIAL,
      },
      resumeSessionId: issue.sessionId,
      onSessionId: (sessionId) => {
        currentSessionId = sessionId
        return deps.setRunState(api, channel, issue.id, issue.activeRunId, {
          session_id: sessionId,
        })
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
      status: "waiting-for-input",
      run_finished_at: new Date().toISOString(),
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
  activeRuns: Map<Promise<void>, { controller: AbortController }>
): void {
  for (const run of activeRuns.values()) {
    run.controller.abort()
  }
}

// The isolated reviewer runtime (GEN-415), built on top of the claim/lease/
// heartbeat/cancel/reconcile/retry pipeline GEN-414 already wired end to
// end. `failReviewRun` is the target of every failure path here — checkout
// verification, session errors, and an invalid/missing structured verdict
// alike — never a fabricated verdict; only a validated
// `ReviewerStructuredOutput` ever reaches `completeReviewRun`.
export async function processReviewRun(
  api: AgentApi,
  config: Config,
  reviewRun: ClaimedReviewRun,
  deps: ProcessReviewRunDeps = defaultProcessReviewRunDeps,
  options: { signal?: AbortSignal } = {}
): Promise<void> {
  const dir = join(config.WORKDIR, `review-${reviewRun.id}`)
  // Sibling of the disposable checkout, not inside it — same reason
  // `processIssue`'s attachmentsDir is: a downloaded attachment must never
  // end up counted as part of "what changed" in the checkout the reviewer
  // inspects.
  const attachmentsDir = join(
    config.WORKDIR,
    `review-${reviewRun.id}-attachments`
  )

  let channel: ReviewRunRealtimeChannel | null = null
  let seq = 0
  // The reconciler judges a live run stale using `coalesce(review_runs.
  // heartbeat_at, review_runs.started_at)` (ADR-0005) — a genuinely
  // long-running reviewer session needs heartbeats throughout its run, not
  // just once at the start, to stay ahead of that window.
  const heartbeatTimer = setInterval(() => {
    api.sendReviewRunHeartbeat(reviewRun.id).catch((error) => {
      logError(
        `review run ${reviewRun.id} heartbeat failed:`,
        describe(error)
      )
    })
  }, HEARTBEAT_INTERVAL_MS)

  try {
    throwIfAborted(options.signal)
    await api.sendReviewRunHeartbeat(reviewRun.id)

    channel = await deps
      .connectReviewRunChannel(api, reviewRun.id)
      .catch((error) => {
        logError(
          `review run ${reviewRun.id} realtime unavailable; continuing with durable logs only:`,
          describe(error)
        )
        return createNoopReviewRunChannel()
      })

    const appendLog = async (entry: {
      role: "assistant" | "system"
      content: string
    }): Promise<void> => {
      seq += 1
      const logEntry = { seq, ...entry }
      await api.appendReviewRunLog(reviewRun.id, logEntry).catch((error) => {
        logError(
          `review run ${reviewRun.id} failed to persist log line:`,
          describe(error)
        )
      })
      await channel?.publishLog(logEntry).catch((error) => {
        logError(
          `review run ${reviewRun.id} failed to broadcast log line:`,
          describe(error)
        )
      })
    }

    throwIfAborted(options.signal)
    const context = await api.fetchReviewRunContext(reviewRun.id)

    throwIfAborted(options.signal)
    await deps.cloneRepoAtSha({
      remoteBase: config.GIT_REMOTE_BASE,
      repo: context.repo,
      sha: reviewRun.headSha,
      dir,
    })
    // Proves checked-out HEAD equals the requested SHA before review begins
    // — the acceptance criterion GEN-415 is built around. A mismatch throws
    // and is reported as an infra failure below, never silently reviewed.
    await deps.verifyHeadSha(dir, reviewRun.headSha)

    throwIfAborted(options.signal)
    const diff = context.pullRequest.baseSha
      ? await deps.diffAgainstBase({
          dir,
          baseSha: context.pullRequest.baseSha,
          headSha: reviewRun.headSha,
        })
      : ""

    throwIfAborted(options.signal)
    const output = await deps.runReviewerSession({
      reviewerProvider: context.reviewerProvider,
      reviewerModel: context.reviewerModel,
      cwd: dir,
      attachmentsDir,
      context,
      diff,
      appendLog,
      signal: options.signal,
    })

    throwIfAborted(options.signal)
    await api.completeReviewRun(reviewRun.id, {
      verdict: output.verdict,
      summary: output.summary ?? null,
      findings: output.findings.map((finding) => ({
        severity: "blocker",
        filePath: finding.filePath ?? null,
        line: finding.line ?? null,
        title: finding.defect,
        evidence: finding.evidence,
        impact: finding.impact,
        requestedChange: finding.requestedChange,
      })),
    })
    logInfo(
      `review run ${reviewRun.id} completed with verdict: ${output.verdict}`
    )
  } catch (error) {
    if (options.signal?.aborted || isSessionCancelled(error)) {
      throw error
    }
    const message = describe(error)
    logError(`review run ${reviewRun.id} failed:`, {
      issueId: reviewRun.issueId,
      pullRequestId: reviewRun.pullRequestId,
      reviewCycleId: reviewRun.reviewCycleId,
      headSha: reviewRun.headSha,
      message,
    })
    await api.failReviewRun(reviewRun.id, { error: message }).catch(
      (failError) => {
        logError(
          `review run ${reviewRun.id} failed to report infra failure:`,
          { issueId: reviewRun.issueId, reviewCycleId: reviewRun.reviewCycleId },
          describe(failError)
        )
      }
    )
  } finally {
    clearInterval(heartbeatTimer)
    if (channel) {
      await channel.close().catch((closeError) => {
        logError(
          "failed to close review run realtime channel:",
          describe(closeError)
        )
      })
    }
    // Discards every workspace change and artifact unconditionally, on both
    // success and failure — the disposable checkout must never outlive the
    // run it was created for.
    await rm(dir, { recursive: true, force: true })
    await rm(attachmentsDir, { recursive: true, force: true })
  }
}

function sleepUntilNextTick(
  deps: Pick<HostLoopDeps, "sleep" | "now">,
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
  deps: Pick<HostLoopDeps, "getToolStatuses" | "now">
): {
  snapshot: () => Promise<HostHeartbeatTelemetry>
} {
  const processStartedAt = deps.now().toISOString()
  let cached: {
    expiresAt: number
    value: HostCapabilities
  } | null = null

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
        setup_completed: config.GENTIC_HOST_SETUP_STATE === "ready",
        provider_capabilities: cached.value,
        last_seen_at: deps.now().toISOString(),
      }
    },
  }
}

function providerCapabilities(tools: ToolStatuses): HostCapabilities {
  return {
    providers: {
      claude_code: toolCapability(tools.claude),
      codex: toolCapability(tools.codex),
    },
  }
}

function toolCapability(
  status: ToolStatuses["claude"]
): HostProviderCapability {
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
  hasUnpublishedAgentChanges: boolean
}

async function recordCompletedTurnState(input: {
  api: AgentApi
  deps: Pick<ProcessIssueDeps, "hasChangesSinceBaseline">
  issue: ClaimedIssue
  dir: string
  baseline: RepoBaseline
}): Promise<CompletedTurnState> {
  const hasPublishableChanges = await input.deps.hasChangesSinceBaseline(
    input.dir,
    input.baseline
  )
  const hasUnpublishedAgentChanges = hasPublishableChanges

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

function createNoopReviewRunChannel(): ReviewRunRealtimeChannel {
  return {
    async publishLog() {},
    async close() {},
  }
}

function describe(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}
