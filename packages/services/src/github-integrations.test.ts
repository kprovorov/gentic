import assert from "node:assert/strict"
import test from "node:test"

import { ServiceError } from "./errors"
import {
  applyPullRequestDeliveryState,
  associatePullRequestFromWebhook,
  buildTrackingIssueContent,
  parseCanonicalIssueBranch,
  upsertGithubIntegration,
} from "./github-integrations"

test("applyPullRequestDeliveryState maps one PR delivery to the atomic aggregate RPC", async () => {
  const calls: Array<Record<string, unknown>> = []
  const result = await applyPullRequestDeliveryState(
    {
      rpc(name: string, args: Record<string, unknown>) {
        calls.push({ name, args })
        return Promise.resolve({
          data: [
            {
              associated_issue_id: "issue-42",
              pull_request_updated: true,
              issue_status_changed: true,
              issue_status: "changes-requested",
            },
          ],
          error: null,
        })
      },
    } as never,
    {
      prUrl: "https://github.com/acme/base/pull/42",
      headSha: "head-42",
      ciState: "success",
      reviewDecision: "changes_requested",
    }
  )

  assert.equal(result?.issue_status, "changes-requested")
  assert.deepEqual(calls, [
    {
      name: "apply_pull_request_delivery_state",
      args: {
        p_pr_url: "https://github.com/acme/base/pull/42",
        p_state: undefined,
        p_head_sha: "head-42",
        p_ci_state: "success",
        p_review_decision: "changes_requested",
        p_expected_head_sha: undefined,
      },
    },
  ])
})

type UpsertResult =
  | { data: Record<string, unknown>; error: null }
  | { data: null; error: { code: string; message: string } }

function githubIntegrationClient(results: UpsertResult[]) {
  const writes: Array<Record<string, unknown>> = []

  return {
    writes,
    client: {
      from(table: string) {
        assert.equal(table, "github_integrations")
        return {
          upsert(
            values: Record<string, unknown>,
            options: { onConflict: string }
          ) {
            assert.deepEqual(options, { onConflict: "user_id" })
            writes.push(values)
            return {
              select(columns: string) {
                assert.equal(columns, "*")
                return {
                  async single() {
                    const result = results.shift()
                    assert.ok(result, "expected a mocked upsert result")
                    return result
                  },
                }
              },
            }
          },
        }
      },
    },
  }
}

function connectedIntegration(userId: string, installationId: string) {
  return {
    id: "10000000-0000-4000-8000-000000000601",
    user_id: userId,
    installation_id: installationId,
    setup_action: "install",
    status: "connected",
    connected_at: "2026-08-05T12:00:00.000Z",
    created_at: "2026-08-05T12:00:00.000Z",
    updated_at: "2026-08-05T12:00:00.000Z",
  }
}

test("upsertGithubIntegration lets the existing owner reconnect repeatedly", async () => {
  const row = connectedIntegration("user_alpha", "installation_123")
  const { client, writes } = githubIntegrationClient([
    { data: row, error: null },
    { data: row, error: null },
  ])

  const input = {
    installationId: "installation_123",
    setupAction: "install",
    status: "connected" as const,
  }

  const first = await upsertGithubIntegration(
    client as never,
    "user_alpha",
    input
  )
  const second = await upsertGithubIntegration(
    client as never,
    "user_alpha",
    input
  )

  assert.equal(first.id, row.id)
  assert.equal(second.id, row.id)
  assert.equal(writes.length, 2)
  assert.equal(writes[0]?.user_id, "user_alpha")
  assert.equal(writes[1]?.installation_id, "installation_123")
})

test("upsertGithubIntegration maps a competing ownership race to a conflict", async () => {
  const ownerRow = connectedIntegration("user_alpha", "installation_123")
  const { client } = githubIntegrationClient([
    { data: ownerRow, error: null },
    {
      data: null,
      error: {
        code: "23505",
        message:
          'duplicate key value violates unique constraint "github_integrations_installation_id_unique"',
      },
    },
  ])

  const [ownerAttempt, competingAttempt] = await Promise.allSettled([
    upsertGithubIntegration(client as never, "user_alpha", {
      installationId: "installation_123",
      setupAction: "install",
      status: "connected",
    }),
    upsertGithubIntegration(client as never, "user_beta", {
      installationId: "installation_123",
      setupAction: "install",
      status: "connected",
    }),
  ])

  assert.equal(ownerAttempt.status, "fulfilled")
  assert.equal(competingAttempt.status, "rejected")
  assert.ok(competingAttempt.reason instanceof ServiceError)
  assert.equal(competingAttempt.reason.code, "conflict")
  assert.equal(
    competingAttempt.reason.message,
    "This GitHub installation is already connected to another Gentic account."
  )
})

test("upsertGithubIntegration keeps unrelated database errors internal", async () => {
  const { client } = githubIntegrationClient([
    {
      data: null,
      error: { code: "42501", message: "permission denied" },
    },
  ])

  await assert.rejects(
    upsertGithubIntegration(client as never, "user_alpha", {
      installationId: "installation_123",
      setupAction: "install",
      status: "connected",
    }),
    (error) =>
      error instanceof ServiceError &&
      error.code === "internal" &&
      error.message === "permission denied"
  )
})

test("parseCanonicalIssueBranch recognizes only canonical codes at the final segment start", () => {
  assert.deepEqual(parseCanonicalIssueBranch("GEN-1"), {
    projectKey: "GEN",
    issueNumber: 1,
  })
  assert.deepEqual(parseCanonicalIssueBranch("users/alice/gEn-42-fix-it"), {
    projectKey: "GEN",
    issueNumber: 42,
  })
  assert.deepEqual(parseCanonicalIssueBranch("ABC1-9"), {
    projectKey: "ABC1",
    issueNumber: 9,
  })

  for (const branch of [
    "GEN-01-fix",
    "GEN-0",
    "prefix-GEN-1",
    "GEN-12fix",
    "GENT-12-fix",
    "GEN-12/fix",
    "feature/",
  ]) {
    assert.equal(parseCanonicalIssueBranch(branch), null, branch)
  }
})

type ScopeTable =
  "github_integrations" | "projects" | "issues" | "issue_pull_requests"
type ScopeRow = Record<string, unknown>

type ScopeResult = { data: ScopeRow | ScopeRow[] | null; error: null }

class ScopeQuery implements PromiseLike<ScopeResult> {
  private filters: Array<{ column: string; value: unknown }> = []
  private single = false

  constructor(private readonly rows: ScopeRow[]) {}

  select() {
    return this
  }

  eq(column: string, value: unknown) {
    this.filters.push({ column, value })
    return this
  }

  // Row order is the fixture's own, which is what the callers that order by
  // `created_at` are asking for.
  order() {
    return this
  }

  maybeSingle() {
    this.single = true
    return this
  }

  then<TResult1 = ScopeResult, TResult2 = never>(
    onfulfilled?:
      | ((value: ScopeResult) => TResult1 | PromiseLike<TResult1>)
      | null,
    onrejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null
  ): Promise<TResult1 | TResult2> {
    const matches = this.rows.filter((row) =>
      this.filters.every((filter) => {
        const value = filter.column
          .split(".")
          .reduce<unknown>(
            (current, part) => (current as ScopeRow | undefined)?.[part],
            row
          )
        return value === filter.value
      })
    )
    const data = this.single ? (matches[0] ?? null) : matches
    return Promise.resolve({ data, error: null }).then(onfulfilled, onrejected)
  }
}

class ScopeSupabase {
  readonly rpcCalls: Array<{
    name: string
    args: Record<string, unknown> | undefined
  }> = []

  constructor(
    readonly tables: Record<ScopeTable, ScopeRow[]>,
    private readonly rpcResult: ScopeRow = {
      association_created: true,
      associated_issue_id: "issue-42",
      issue_status_changed: true,
    }
  ) {}

  from(table: ScopeTable) {
    return new ScopeQuery(this.tables[table])
  }

  rpc(name: string, args?: Record<string, unknown>) {
    this.rpcCalls.push({ name, args })
    const existing = this.tables.issue_pull_requests.find(
      (row) => row.url === args?.p_pr_url
    )
    return Promise.resolve({
      data: [
        existing
          ? {
              ...this.rpcResult,
              association_created: false,
              associated_issue_id: existing.issue_id,
            }
          : this.rpcResult,
      ],
      error: null,
    })
  }
}

function scopedWebhookClient(
  repo = "acme/base",
  options: { automaticReviewEnabled?: boolean; rpcResult?: ScopeRow } = {}
) {
  return new ScopeSupabase(
    {
      issue_pull_requests: [],
      github_integrations: [
        {
          user_id: "user-1",
          installation_id: "12345",
          status: "connected",
        },
      ],
      projects: [
        {
          id: "project-1",
          user_id: "user-1",
          key: "GEN",
          repo,
          automatic_review_enabled: options.automaticReviewEnabled ?? false,
        },
      ],
      issues: [
        {
          id: "issue-42",
          project_id: "project-1",
          number: 42,
          projects: { user_id: "user-1", repo },
        },
      ],
    },
    options.rpcResult
  )
}

const scopedAssociationInput = {
  installationId: "12345",
  baseRepository: "Acme/Base",
  headRepository: "Acme/Base",
  headBranch: "fork-owner/GeN-42-fix-webhook",
  prUrl: "https://github.com/acme/base/pull/42",
  prNumber: 42,
  prTitle: "Fix the webhook",
  prAuthorLogin: "alice",
  prState: "open" as const,
  readyForReview: true,
  headSha: "head-42",
}

test("associatePullRequestFromWebhook scopes by installation, base repository, project key, and issue number", async () => {
  const supabase = scopedWebhookClient()

  const result = await associatePullRequestFromWebhook(
    supabase as never,
    scopedAssociationInput
  )

  assert.deepEqual(result, {
    outcome: "associated",
    issueId: "issue-42",
    statusChanged: true,
  })
  assert.deepEqual(supabase.rpcCalls, [
    {
      name: "associate_pull_request_from_webhook",
      args: {
        p_issue_id: "issue-42",
        p_pr_url: "https://github.com/acme/base/pull/42",
        p_pr_state: "open",
        p_ready_for_review: true,
        p_head_sha: "head-42",
      },
    },
  ])
})

test("associatePullRequestFromWebhook keeps an existing association sticky after a branch change", async () => {
  const supabase = scopedWebhookClient()
  supabase.tables.issue_pull_requests.push({
    issue_id: "issue-42",
    url: scopedAssociationInput.prUrl,
  })

  const result = await associatePullRequestFromWebhook(supabase as never, {
    ...scopedAssociationInput,
    headBranch: "feature/no-longer-an-issue-branch",
  })

  assert.deepEqual(result, {
    outcome: "already_associated",
    issueId: "issue-42",
    statusChanged: true,
  })
  assert.equal(supabase.rpcCalls[0]?.args?.p_issue_id, "issue-42")
})

test("associatePullRequestFromWebhook rejects unmatched installation and repository scope without writing", async () => {
  const missingInstallation = scopedWebhookClient()
  const installationResult = await associatePullRequestFromWebhook(
    missingInstallation as never,
    { ...scopedAssociationInput, installationId: "99999" }
  )
  assert.deepEqual(installationResult, {
    outcome: "no_match",
    reason: "installation_not_connected",
  })
  assert.deepEqual(missingInstallation.rpcCalls, [])

  // The branch names GEN-42, but that Project is on another repository — and
  // no Project owns the base repository either, so there is nothing to track
  // the pull request against.
  const wrongRepository = scopedWebhookClient("acme/other")
  const repositoryResult = await associatePullRequestFromWebhook(
    wrongRepository as never,
    scopedAssociationInput
  )
  assert.deepEqual(repositoryResult, {
    outcome: "no_match",
    reason: "project_not_found",
  })
  assert.deepEqual(wrongRepository.rpcCalls, [])
})

const externalPullRequestInput = {
  ...scopedAssociationInput,
  headBranch: "alice/hand-written-fix",
  prUrl: "https://github.com/acme/base/pull/77",
  prNumber: 77,
  prTitle: "Bump the flaky timeout",
  prAuthorLogin: "alice",
  headSha: "head-77",
}

test("associatePullRequestFromWebhook tracks a pull request no issue produced when the project reviews automatically", async () => {
  const supabase = scopedWebhookClient("acme/base", {
    automaticReviewEnabled: true,
    rpcResult: {
      association_created: true,
      associated_issue_id: "issue-77",
      issue_status_changed: false,
    },
  })

  const result = await associatePullRequestFromWebhook(
    supabase as never,
    externalPullRequestInput
  )

  assert.deepEqual(result, {
    outcome: "associated",
    issueId: "issue-77",
    statusChanged: false,
    trackedExternally: true,
  })
  assert.equal(supabase.rpcCalls.length, 1)
  const call = supabase.rpcCalls[0]
  assert.equal(call?.name, "track_external_pull_request")
  assert.equal(call?.args?.p_project_id, "project-1")
  assert.equal(call?.args?.p_pr_url, "https://github.com/acme/base/pull/77")
  assert.equal(call?.args?.p_head_sha, "head-77")
  assert.equal(call?.args?.p_title, "PR #77: Bump the flaky timeout")
  assert.match(String(call?.args?.p_body), /acme\/base#77, opened by @alice/)
})

test("associatePullRequestFromWebhook tracks a branch whose issue code resolves to nothing", async () => {
  const supabase = scopedWebhookClient("acme/base", {
    automaticReviewEnabled: true,
  })

  const result = await associatePullRequestFromWebhook(supabase as never, {
    ...externalPullRequestInput,
    headBranch: "GEN-999-deleted-issue",
  })

  assert.equal(result.outcome, "associated")
  assert.equal(supabase.rpcCalls[0]?.name, "track_external_pull_request")
})

test("associatePullRequestFromWebhook leaves fork, draft, and unreviewed pull requests untracked", async () => {
  const fork = scopedWebhookClient("acme/base", {
    automaticReviewEnabled: true,
  })
  assert.deepEqual(
    await associatePullRequestFromWebhook(fork as never, {
      ...externalPullRequestInput,
      headRepository: "alice/base-fork",
    }),
    { outcome: "no_match", reason: "forked_head_repository" }
  )
  assert.deepEqual(fork.rpcCalls, [])

  // A draft says so through `readyForReview`; the diagnostic stays the one
  // the head branch earned, since the draft is what declined tracking.
  const draft = scopedWebhookClient("acme/base", {
    automaticReviewEnabled: true,
  })
  assert.deepEqual(
    await associatePullRequestFromWebhook(draft as never, {
      ...externalPullRequestInput,
      prState: "draft",
      readyForReview: false,
    }),
    { outcome: "no_match", reason: "invalid_issue_branch" }
  )
  assert.deepEqual(draft.rpcCalls, [])

  const reviewDisabled = scopedWebhookClient("acme/base")
  assert.deepEqual(
    await associatePullRequestFromWebhook(
      reviewDisabled as never,
      externalPullRequestInput
    ),
    { outcome: "no_match", reason: "automatic_review_disabled" }
  )
  assert.deepEqual(reviewDisabled.rpcCalls, [])
})

test("associatePullRequestFromWebhook keeps a tracked pull request on its tracking issue", async () => {
  const supabase = scopedWebhookClient("acme/base", {
    automaticReviewEnabled: true,
  })
  // Once a tracking issue owns the pull request, later deliveries take the
  // ordinary sticky-association path — no second issue is ever created.
  supabase.tables.issue_pull_requests.push({
    issue_id: "issue-42",
    url: externalPullRequestInput.prUrl,
  })

  const result = await associatePullRequestFromWebhook(
    supabase as never,
    externalPullRequestInput
  )

  assert.deepEqual(result, {
    outcome: "already_associated",
    issueId: "issue-42",
    statusChanged: true,
  })
  assert.equal(
    supabase.rpcCalls[0]?.name,
    "associate_pull_request_from_webhook"
  )
})

test("buildTrackingIssueContent names the pull request and says no specification stands behind it", () => {
  const content = buildTrackingIssueContent({
    prNumber: 7,
    prTitle: "  Tidy the parser  ",
    prAuthorLogin: "alice",
    prUrl: "https://github.com/acme/base/pull/7",
    baseRepository: "acme/base",
  })

  assert.equal(content.title, "PR #7: Tidy the parser")
  assert.match(content.body, /https:\/\/github\.com\/acme\/base\/pull\/7/)
  assert.match(content.body, /no issue specification behind the change/)

  const untitled = buildTrackingIssueContent({
    prNumber: 8,
    prTitle: null,
    prAuthorLogin: null,
    prUrl: "https://github.com/acme/base/pull/8",
    baseRepository: "acme/base",
  })

  assert.equal(untitled.title, "PR #8: Untitled pull request")
  assert.match(untitled.body, /opened by GitHub/)

  const long = buildTrackingIssueContent({
    prNumber: 9,
    prTitle: "x".repeat(400),
    prAuthorLogin: "alice",
    prUrl: "https://github.com/acme/base/pull/9",
    baseRepository: "acme/base",
  })

  assert.equal(long.title.length, 160)
})
