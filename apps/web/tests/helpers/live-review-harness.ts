import { randomBytes, randomUUID } from "node:crypto"
import test, { type TestContext } from "node:test"

import { createServiceClient } from "@gentic/supabase/service"

// This tier drives the real Postgres state machine and the real webhook/
// agent-API route functions (no `supabase.rpc()` fakes) — the layer the
// rest of `apps/web/tests` deliberately fakes out. It needs a local
// Supabase instance (`supabase start`); CI already runs one before `pnpm
// test`, but most local/sandboxed runs don't have Docker. `liveTest` skips
// cleanly rather than failing when `SUPABASE_URL`/`SUPABASE_SECRET_KEY`
// aren't set, so `pnpm test` stays green either way. See
// docs/adr/0008-automatic-review-e2e-hardening.md.
export function hasLiveSupabase(): boolean {
  // Mirrors createServiceClient()'s own URL fallback so a normal local
  // `.env.local` (which only sets NEXT_PUBLIC_SUPABASE_URL) already enables
  // this tier without extra configuration.
  const url = process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL
  return Boolean(url && process.env.SUPABASE_SECRET_KEY)
}

const SKIP_REASON =
  "requires a local Supabase instance (SUPABASE_URL/SUPABASE_SECRET_KEY unset — run `supabase start` first)"

export function liveTest(
  name: string,
  fn: (t: TestContext) => void | Promise<void>
) {
  test(name, { skip: hasLiveSupabase() ? false : SKIP_REASON }, fn)
}

export function createTestServiceClient() {
  return createServiceClient()
}

export type TestSupabase = ReturnType<typeof createTestServiceClient>

// A fresh, all-lowercase-safe id namespace per test so concurrent test files
// (and concurrent scenarios within the race test file) never collide.
export function testAccount(label: string) {
  return `e2e-${label}-${randomUUID().slice(0, 8)}`
}

function randomCredentialHash() {
  return randomBytes(32).toString("hex")
}

type SeededIds = {
  projectIds: string[]
  issueIds: string[]
  pullRequestIds: string[]
  workerIds: string[]
  githubIntegrationUserIds: string[]
}

export function newSeedTracker(): SeededIds {
  return {
    projectIds: [],
    issueIds: [],
    pullRequestIds: [],
    workerIds: [],
    githubIntegrationUserIds: [],
  }
}

export async function seedProject(
  supabase: TestSupabase,
  tracker: SeededIds,
  input: {
    userId: string
    key: string
    repo: string
    automaticReviewEnabled?: boolean
  }
) {
  const { data, error } = await supabase
    .from("projects")
    .insert({
      user_id: input.userId,
      name: `Test project ${input.key}`,
      repo: input.repo,
      key: input.key,
      automatic_review_enabled: input.automaticReviewEnabled ?? true,
    })
    .select("id")
    .single()

  if (error) throw error
  tracker.projectIds.push(data.id as string)
  return data.id as string
}

export async function seedGithubIntegration(
  supabase: TestSupabase,
  tracker: SeededIds,
  input: { userId: string; installationId: string }
) {
  const { error } = await supabase.from("github_integrations").insert({
    user_id: input.userId,
    installation_id: input.installationId,
    status: "connected",
    connected_at: new Date().toISOString(),
  })

  if (error) throw error
  tracker.githubIntegrationUserIds.push(input.userId)
}

export async function seedIssue(
  supabase: TestSupabase,
  tracker: SeededIds,
  input: {
    projectId: string
    number: number
    title?: string
    status?: string
    sessionId?: string
  }
) {
  const { data, error } = await supabase
    .from("issues")
    .insert({
      project_id: input.projectId,
      title: input.title ?? `Test issue ${input.number}`,
      body: "Body",
      status: input.status ?? "ready-for-review",
      number: input.number,
      agent_provider: "claude_code",
      session_id: input.sessionId ?? null,
    })
    .select("id")
    .single()

  if (error) throw error
  tracker.issueIds.push(data.id as string)
  return data.id as string
}

export async function seedPullRequest(
  supabase: TestSupabase,
  tracker: SeededIds,
  input: {
    issueId: string
    url: string
    state?: string
    headSha: string
    ciState?: string
  }
) {
  const { data, error } = await supabase
    .from("issue_pull_requests")
    .insert({
      issue_id: input.issueId,
      url: input.url,
      state: input.state ?? "open",
      head_sha: input.headSha,
      ci_state: input.ciState ?? "success",
    })
    .select("id")
    .single()

  if (error) throw error
  tracker.pullRequestIds.push(data.id as string)
  return data.id as string
}

export async function seedWorker(
  supabase: TestSupabase,
  tracker: SeededIds,
  input: { userId: string; displayName: string }
) {
  const { data, error } = await supabase
    .from("workers")
    .insert({
      user_id: input.userId,
      display_name: input.displayName,
      credential_hash: randomCredentialHash(),
      setup_state: "ready",
      last_seen_at: new Date().toISOString(),
      provider_capabilities: { providers: {} },
    })
    .select("id")
    .single()

  if (error) throw error
  tracker.workerIds.push(data.id as string)
  return data.id as string
}

async function selectIds(
  supabase: TestSupabase,
  table: "review_cycles" | "review_runs" | "review_attempts",
  column: string,
  values: string[]
): Promise<string[]> {
  if (values.length === 0) return []
  const { data, error } = await supabase
    .from(table)
    .select("id")
    .in(column, values)
  if (error) throw error
  return (data ?? []).map((row) => row.id as string)
}

// Deletes bottom-up by tracked id rather than relying on FK cascade, so
// cleanup doesn't silently rot if a future migration changes cascade
// behavior on any of these tables. Each level's ids are fetched first since
// the Supabase JS client's `.in()` filter takes a plain value array, not a
// nested query.
export async function cleanupSeeded(
  supabase: TestSupabase,
  tracker: SeededIds
) {
  if (tracker.pullRequestIds.length > 0) {
    const cycleIds = await selectIds(
      supabase,
      "review_cycles",
      "pull_request_id",
      tracker.pullRequestIds
    )
    const runIds = await selectIds(
      supabase,
      "review_runs",
      "review_cycle_id",
      cycleIds
    )
    const attemptIds = await selectIds(
      supabase,
      "review_attempts",
      "review_cycle_id",
      cycleIds
    )

    if (runIds.length > 0) {
      await supabase.from("review_run_logs").delete().in("review_run_id", runIds)
    }
    if (attemptIds.length > 0) {
      await supabase
        .from("review_findings")
        .delete()
        .in("review_attempt_id", attemptIds)
    }
    if (cycleIds.length > 0) {
      await supabase.from("review_attempts").delete().in("review_cycle_id", cycleIds)
      await supabase.from("review_runs").delete().in("review_cycle_id", cycleIds)
      await supabase.from("review_cycles").delete().in("id", cycleIds)
    }
    await supabase
      .from("issue_pull_requests")
      .delete()
      .in("id", tracker.pullRequestIds)
  }

  if (tracker.issueIds.length > 0) {
    await supabase.from("messages").delete().in("issue_id", tracker.issueIds)
    await supabase
      .from("issue_events")
      .delete()
      .in("issue_id", tracker.issueIds)
    await supabase
      .from("issue_review_policies")
      .delete()
      .in("issue_id", tracker.issueIds)
    await supabase
      .from("issue_implementation_owners")
      .delete()
      .in("issue_id", tracker.issueIds)
    await supabase.from("issues").delete().in("id", tracker.issueIds)
  }

  if (tracker.workerIds.length > 0) {
    await supabase.from("workers").delete().in("id", tracker.workerIds)
  }

  if (tracker.githubIntegrationUserIds.length > 0) {
    await supabase
      .from("github_integrations")
      .delete()
      .in("user_id", tracker.githubIntegrationUserIds)
  }

  if (tracker.projectIds.length > 0) {
    await supabase.from("projects").delete().in("id", tracker.projectIds)
  }
}
