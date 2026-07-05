import {
  getAgentContext,
  handleAgentError,
  json,
  type Supabase,
} from "../../_lib"

export const runtime = "nodejs"

const CANDIDATE_BATCH_SIZE = 50

type QueuedIssueCandidate = {
  id: string
  agent_provider: "claude_code" | "codex"
  session_id: string | null
  run_finished_at: string | null
}

export async function POST(request: Request) {
  try {
    const { supabase, userId } = await getAgentContext(request)
    return json({ issue: await claimNextQueuedIssue(supabase, userId) })
  } catch (error) {
    return handleAgentError(error)
  }
}

async function claimNextQueuedIssue(supabase: Supabase, userId: string) {
  let offset = 0

  while (true) {
    const candidates = await listQueuedIssueCandidates(supabase, userId, offset)
    if (candidates.length === 0) {
      return null
    }

    const blockedIssueIds = await listBlockedIssueIds(
      supabase,
      candidates.map((candidate) => candidate.id)
    )

    const candidate = candidates.find(
      (candidate) => !blockedIssueIds.has(candidate.id)
    )
    if (!candidate) {
      offset += candidates.length
      continue
    }

    const claimed = await claimIssue(supabase, candidate.id)
    if (!claimed) {
      return null
    }

    const project = extractProject(candidate)

    return {
      id: candidate.id,
      agentProvider: candidate.agent_provider,
      repo: project.repo,
      setupScript: project.setup_script,
      sessionId: candidate.session_id,
      runFinishedAt: candidate.run_finished_at,
    }
  }
}

async function listQueuedIssueCandidates(
  supabase: Supabase,
  userId: string,
  offset: number
) {
  const { data: candidate, error: candidateError } = await supabase
    .from("issues")
    .select(
      "id, agent_provider, session_id, run_finished_at, projects!inner(repo,setup_script,user_id)"
    )
    .eq("run_status", "queued")
    .eq("projects.user_id", userId)
    .order("updated_at", { ascending: true })
    .range(offset, offset + CANDIDATE_BATCH_SIZE - 1)
    .returns<QueuedIssueCandidate[]>()

  if (candidateError) {
    throw new Error(candidateError.message)
  }

  return candidate
}

async function listBlockedIssueIds(supabase: Supabase, issueIds: string[]) {
  if (issueIds.length === 0) {
    return new Set<string>()
  }

  const { data, error } = await supabase
    .from("issue_relations")
    .select(
      "target_issue_id, source_issue:issues!issue_relations_source_issue_id_fkey(status)"
    )
    .eq("type", "blocks")
    .in("target_issue_id", issueIds)
    .returns<{ target_issue_id: string; source_issue: { status: string } }[]>()

  if (error) {
    throw new Error(error.message)
  }

  const blockedIssueIds = new Set<string>()
  for (const relation of data) {
    if (
      relation.source_issue.status !== "completed" &&
      relation.source_issue.status !== "cancelled"
    ) {
      blockedIssueIds.add(relation.target_issue_id)
    }
  }

  return blockedIssueIds
}

async function claimIssue(supabase: Supabase, id: string) {
  const now = new Date().toISOString()
  const { data: claimed, error: claimError } = await supabase
    .from("issues")
    .update({
      status: "in-progress",
      run_status: "cloning",
      run_started_at: now,
      run_error: null,
      run_finished_at: null,
      updated_at: now,
    })
    .eq("id", id)
    .eq("run_status", "queued")
    .select("id")
    .maybeSingle()

  if (claimError) {
    throw new Error(claimError.message)
  }
  if (!claimed) {
    return null
  }

  return claimed
}

function extractProject(row: unknown): {
  repo: string
  setup_script: string | null
} {
  const projects = (row as { projects?: unknown }).projects
  const project = Array.isArray(projects) ? projects[0] : projects
  const repo = (project as { repo?: string } | undefined)?.repo
  if (!repo) {
    throw new Error("Issue has no associated project repo")
  }
  const setup_script =
    (project as { setup_script?: string | null } | undefined)?.setup_script ??
    null
  return { repo, setup_script }
}
