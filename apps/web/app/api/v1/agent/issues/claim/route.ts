import { randomUUID } from "node:crypto"

import { getIssueCode } from "@gentic/services/issues"
import { getWorker } from "@gentic/services/workers"
import type { WorkerCompatibilityPolicy } from "@gentic/services/workers"
import type { AgentProvider } from "@gentic/validators/issues"
import { claimIssueInputSchema } from "@gentic/validators/agent"

import {
  getAgentContext,
  handleAgentError,
  json,
  type Supabase,
} from "../../_lib"

export const runtime = "nodejs"

const CLAIM_ISSUE_SELECT =
  "id, number, title, status, agent_provider, issue_model, session_id, pr_url, prompt, create_pr_automatically, has_unpublished_agent_changes, projects!inner(key,repo,setup_script,user_id), unfinished_blockers:issue_relations!issue_relations_target_issue_id_fkey(source_issue:issues!issue_relations_source_issue_id_fkey!inner(status))"

function eligibleIssueFilter(now: string): string {
  return `status.eq.todo,and(status.eq.held,usage_limit_reset_at.lte.${now})`
}

export async function POST(request: Request) {
  try {
    const { supabase, userId, workerId } = await getAgentContext(request)
    claimIssueInputSchema.parse(await request.json().catch(() => ({})))
    return json({
      issue: await claimNextQueuedIssue(supabase, userId, workerId),
    })
  } catch (error) {
    return handleAgentError(error)
  }
}

export async function claimNextQueuedIssue(
  supabase: Supabase,
  userId: string,
  workerId: string,
  options: { compatibilityPolicy?: WorkerCompatibilityPolicy } = {}
) {
  const worker = await getWorker(supabase, userId, workerId, {
    compatibilityPolicy: options.compatibilityPolicy,
  })
  if (worker.primary_state !== "online") {
    return null
  }
  if (worker.version_health === "unsupported") {
    return null
  }
  if (worker.running_task_count >= worker.configured_capacity) {
    return null
  }

  const eligibleProviders = getWorkerEligibleIssueProviders(worker.providers)
  if (eligibleProviders.length === 0) {
    return null
  }

  const now = new Date().toISOString()
  const { data: candidate, error: candidateError } = await supabase
    .from("issues")
    .select(CLAIM_ISSUE_SELECT)
    .or(eligibleIssueFilter(now))
    .eq("projects.user_id", userId)
    .in("agent_provider", eligibleProviders)
    .is("active_run_id", null)
    .eq("unfinished_blockers.type", "blocks")
    .not(
      "unfinished_blockers.source_issue.status",
      "in",
      "(completed,cancelled)"
    )
    .is("unfinished_blockers", null)
    .order("priority", { ascending: false })
    .order("updated_at", { ascending: true })
    .limit(1)
    .maybeSingle()

  if (candidateError) {
    throw new Error(candidateError.message)
  }
  if (!candidate) {
    return null
  }

  const { id } = candidate
  const activeRunId = randomUUID()
  const { data: claimed, error: claimError } = await supabase
    .from("issues")
    .update({
      status: "queued",
      active_run_id: activeRunId,
      run_started_at: now,
      run_error: null,
      run_finished_at: null,
      usage_limit_reset_at: null,
      active_worker_id: workerId,
      updated_at: now,
    })
    .eq("id", id)
    .or(eligibleIssueFilter(now))
    .in("agent_provider", eligibleProviders)
    .is("active_run_id", null)
    .select("id")
    .maybeSingle()

  if (claimError) {
    throw new Error(claimError.message)
  }
  if (!claimed) {
    return null
  }

  if (!candidate.projects.repo) {
    throw new Error("Issue has no associated project repo")
  }

  if (candidate.status === "todo") {
    await ensureTodoIssueHasPendingPrompt(supabase, id, candidate.prompt)
  }

  return {
    id,
    activeRunId,
    code: getIssueCode(candidate.projects.key, candidate.number),
    title: candidate.title,
    agentProvider: candidate.agent_provider,
    issueModel: candidate.issue_model,
    repo: candidate.projects.repo,
    setupScript: candidate.projects.setup_script,
    sessionId: candidate.session_id,
    prUrl: candidate.pr_url,
    createPrAutomatically: candidate.create_pr_automatically,
    hasUnpublishedAgentChanges: candidate.has_unpublished_agent_changes,
  }
}

function getWorkerEligibleIssueProviders(
  providers: Awaited<ReturnType<typeof getWorker>>["providers"]
): AgentProvider[] {
  const result: AgentProvider[] = []
  if (isProviderReady(providers.codex)) {
    result.push("codex")
  }
  if (isProviderReady(providers.claude_code)) {
    result.push("claude_code")
  }
  return result
}

function isProviderReady(
  provider: Awaited<ReturnType<typeof getWorker>>["providers"]["codex"]
): boolean {
  return Boolean(
    provider?.installed && provider.authenticated === true
  )
}

export async function ensureTodoIssueHasPendingPrompt(
  supabase: Supabase,
  issueId: string,
  prompt: string | null
) {
  const { data: pendingMessages, error: pendingMessagesError } = await supabase
    .from("messages")
    .select("id")
    .eq("issue_id", issueId)
    .eq("role", "user")
    .is("consumed_by_run_id", null)
    .limit(1)

  if (pendingMessagesError) {
    throw new Error(pendingMessagesError.message)
  }
  if (pendingMessages && pendingMessages.length > 0) {
    return
  }

  const { error: insertError } = await supabase.from("messages").insert({
    issue_id: issueId,
    role: "user",
    content: prompt ?? "",
  })

  if (insertError) {
    throw new Error(insertError.message)
  }
}
