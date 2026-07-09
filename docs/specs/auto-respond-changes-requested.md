# Spec: Auto-respond to "changes requested" PR reviews

## Summary

When a reviewer submits a **changes requested** review on a pull request that
Gentic created, Gentic should automatically feed the review feedback back to
the coding agent and re-queue the issue, so the agent fixes its own PR without
the user manually copying reviewer comments into the issue chat.

Today the `pull_request_review` webhook handler only flips the issue status to
`changes-requested`. The user must open the PR, read the review, and paste the
feedback into the issue chat to get the agent moving again. This feature closes
that loop.

## Goals

- A `changes_requested` review on a tracked PR automatically inserts the
  review body **and its inline line comments** as a user message on the issue
  and re-queues the agent run.
- The agent resumes its existing session (same `session_id`), pushes fixes to
  the same PR branch, and the normal review cycle repeats.
- Exactly one auto-response per review, even if GitHub redelivers the webhook.
- Users can turn the behavior off per project.

## Non-goals (out of scope for v1)

- Reacting to `commented` or `approved` review states (approved already has
  status-only handling; keep it).
- Reacting to standalone PR comments (`issue_comment`) or review-thread
  replies (`pull_request_review_comment` events).
- Posting replies back to GitHub (e.g. "on it" or resolving threads).
- CI / check-run automation (separate feature).
- Any worker (`apps/gentic`) changes — the existing claim/resume flow already
  handles re-queued issues with a saved session.

## Current behavior (for reference)

- `apps/web/app/api/integrations/github/webhook/route.ts` verifies the HMAC
  signature and, on `pull_request_review` / `submitted` /
  `changes_requested`, calls `updateIssueStatusByPrUrl(supabase, prUrl,
  "changes-requested")` — a status write and nothing else.
- `sendIssueMessage` (`packages/services/src/issues.ts`) is the existing
  follow-up mechanism: insert a `role: "user"` message, then set
  `run_status: "queued"` if the current run is in a terminal state
  (`completed` / `failed` / `cancelled`).
- The worker claims `run_status = "queued"` issues, resumes the saved
  `session_id`, and replays user messages created after `run_finished_at`
  (`apps/gentic/src/worker.ts`), so a message inserted after the run finished
  is delivered to the resumed session with no worker changes.
- The GitHub App exists (installation flow in
  `app/api/integrations/github/{setup,callback}/route.ts`,
  `github_integrations` table) but the web app holds **no App API
  credentials** — only `GITHUB_WEBHOOK_SECRET`. It cannot call the GitHub API
  yet.

## Design

### Flow

```
Reviewer submits "changes requested" review
        │  pull_request_review webhook (HMAC-verified)
        ▼
webhook route
  1. match issue by pr_url; project has auto_respond_to_reviews on?  ── no ─▶ status-only (today's behavior)
  2. set issue status = "changes-requested"                (existing)
  3. fetch the review's inline comments via GitHub API     (new)
  4. compose feedback message                              (new)
  5. insert role=user message, dedup by review id          (new)
  6. re-queue run if run_status is terminal                (existing pattern)
        │
        ▼
worker claims issue → resumes session → agent reads feedback,
fixes, pushes to the same branch → PR updates → reviewer re-reviews
```

### 1. GitHub App API credentials

New web-app environment variables (documented in `docs/github-app.md`):

| Variable | Value |
| --- | --- |
| `GITHUB_APP_ID` | The App's numeric id, from the App settings page. |
| `GITHUB_APP_PRIVATE_KEY` | PEM private key generated in App settings. Stored with literal `\n` escapes; code normalizes them back to newlines. |

New module `apps/web/lib/github/app-auth.ts`:

- `createAppJwt()` — RS256-signed JWT (`iss` = app id, ~10 min expiry, `iat`
  60 s in the past for clock skew) built with `node:crypto`'s `createSign`.
  No new dependency; this matches the codebase's hand-rolled webhook
  verification rather than pulling in Octokit for two endpoints.
- `getInstallationToken(installationId: string)` — POST
  `/app/installations/{installation_id}/access_tokens` with the App JWT.
  Cache tokens in module-level memory keyed by installation id and refresh
  when within 5 minutes of expiry (tokens live 1 h). In-process cache only —
  same tier-1 approach as the agent-API key cache; Redis is unnecessary at
  webhook volume.

The installation id comes from the webhook payload (`payload.installation.id`).
The payload is HMAC-verified, so the id is trusted without a
`github_integrations` lookup. No new App permissions are required — the
existing **Pull requests: Read-only** covers listing review comments, and the
app already subscribes to **Pull request review** events.

### 2. Fetching the review feedback

The `pull_request_review` payload includes `review.id`, `review.body`,
`review.state`, `review.user.login`, `repository.full_name`, and
`pull_request.number` — but **not** the inline line comments. Fetch them with
the installation token:

```
GET /repos/{owner}/{repo}/pulls/{pull_number}/reviews/{review_id}/comments
```

Each comment provides `path`, `line` (or `original_line` when the code moved),
`diff_hunk`, and `body`. Paginate with `per_page=100`; a review with more than
100 inline comments may truncate beyond the first page — acceptable for v1,
noted in the message when it happens.

New module `apps/web/lib/github/reviews.ts` exporting
`fetchReviewComments({ installationId, repoFullName, pullNumber, reviewId })`.

**Fallback:** if minting the token or fetching comments fails (missing env
vars, revoked installation, GitHub outage), log the error and proceed with the
review body alone, noting in the message that inline comments could not be
retrieved. A degraded message that still wakes the agent beats a silent drop —
GitHub does not retry webhook deliveries.

### 3. Composing the feedback message

Plain markdown, `role: "user"`, `kind: "text"` — indistinguishable from a
human follow-up as far as the worker is concerned:

```markdown
The reviewer **{login}** requested changes on the pull request ({pr_url}).
Address every point below, then commit and push the fixes to the same branch —
do not open a new pull request.

## Review summary

{review.body, or "(no summary provided)"}

## Inline comments

### {path}:{line}
```diff
{diff_hunk}
```
> {comment.body}

… one section per inline comment …
```

Composition lives in a pure function
(`composeReviewFollowUp(review, comments): string`) so it can be unit-tested
without any GitHub plumbing.

### 4. Service layer: `applyChangesRequestedReview`

New function in `packages/services/src/issues.ts`, following the existing
trusted-server pattern of `updateIssueStatusByPrUrl` (no `userId`; the caller
is authenticated by the webhook signature, and `pr_url` uniquely identifies
the issue):

```ts
export async function applyChangesRequestedReview(
  supabase: Supabase,
  prUrl: string,
  review: { githubReviewId: number; content: string }
): Promise<
  | { outcome: "queued" | "message_only" | "duplicate" }
  | { outcome: "not_tracked" | "disabled" }
>
```

Steps:

1. Select the issue by `pr_url`, joining
   `projects(auto_respond_to_reviews)`; return `not_tracked` when no row
   matches.
2. Set `status = "changes-requested"`, `updated_at = now()` (replaces the
   current separate `updateIssueStatusByPrUrl` call — one lookup instead of
   two). This happens even when auto-respond is disabled, preserving today's
   behavior; return `disabled` in that case.
3. Insert the message with the review's id for idempotency (see §6). If the
   insert conflicts, return `duplicate` and stop — a redelivered webhook must
   not re-queue a run.
4. Re-queue exactly as `sendIssueMessage` does: set `run_status = "queued"`
   only when the current `run_status` is `completed` / `failed` /
   `cancelled`. If a run is active, the message alone is enough — the
   worker's `nextPrompt` poll loop picks it up mid-session
   (`message_only`).

The webhook route (`handlePullRequestReviewEvent`) becomes: on
`submitted` + `changes_requested` → fetch comments (best-effort) → compose →
`applyChangesRequestedReview`. The `approved` branch is unchanged. The route
must still return 200 quickly; total added latency is two GitHub API calls,
well within webhook timeout.

### 5. Schema changes (one new migration)

```sql
-- Per-project kill switch. Default on: fixing its own PRs is the product's
-- core promise, and the toggle exists for repos with noisy/bot reviewers.
alter table public.projects
  add column auto_respond_to_reviews boolean not null default true;

-- Dedup key for webhook redeliveries. Null for every human-authored message.
alter table public.messages
  add column github_review_id bigint;

create unique index messages_issue_github_review_unique
  on public.messages (issue_id, github_review_id)
  where github_review_id is not null;
```

Insert uses the service client; RLS message policies (`role = 'user'` +
ownership) don't apply to this path, matching how the agent API writes
messages today. The unique index makes step 3 above idempotent via
`on conflict do nothing` semantics (detect the 23505 and translate it to
`duplicate`, mirroring `addIssueRelation`).

### 6. Settings UI + validators

- `packages/validators/src/projects.ts`: add
  `auto_respond_to_reviews: z.boolean().default(true)` to `projectSchema`.
- Settings page (`apps/web/app/settings/settings-view.tsx`): a labeled
  checkbox per project — "Automatically send PR review feedback to the
  agent" — wired through the existing `updateProject` action.
- MCP `create_project` / `update_project` (`apps/web/lib/mcp/handler.ts`):
  expose the same optional boolean so agents managing projects over MCP can
  set it.

## Edge cases and risks

| Case | Behavior |
| --- | --- |
| Review on a PR Gentic doesn't track | `pr_url` matches nothing → no-op (`not_tracked`). |
| Webhook redelivery / duplicate event | Unique `(issue_id, github_review_id)` index → message insert conflicts → no re-queue (`duplicate`). |
| Review submitted while a run is active | Message inserted, no re-queue; the live session consumes it on its next poll (`message_only`). |
| Review body empty, inline comments only | Message renders "(no summary provided)" plus the comments. |
| Comment fetch fails / credentials missing | Fall back to review-body-only message with a note; never drop the event. Missing `GITHUB_APP_ID`/private key logs a config error once per process. |
| Review author is a bot | Treated like any reviewer in v1. Loop risk is bounded: one auto-response per review id, and a new run only starts when the previous one finished. A per-issue auto-response cap is a possible follow-up if bot reviewers cause churn. |
| Issue was reset (`resetIssueAgent`) between review and processing | Reset wipes messages; a late-arriving review message simply lands as the next user message on the fresh run — harmless. |
| Issue status is `merged`/`cancelled` | GitHub does not emit `changes_requested` reviews on closed PRs in practice; if one arrives (race with close), the message is inserted and the issue re-queued — same as a human follow-up after merge, which the product already permits. |
| >100 inline comments | Only the first page is included; the message notes the truncation. |

Status-flow note: when the re-queued issue is claimed, the claim endpoint sets
`status = "in-progress"` (existing behavior), so the `changes-requested` badge
clears as soon as the agent starts working — consistent with how manual
follow-ups behave today.

## Testing

The web app has no test runner (only `apps/gentic` does), so:

- Keep `composeReviewFollowUp` and the JWT builder as pure functions; if a web
  test runner is added later they're trivially unit-testable. Until then,
  verify by construction and manual runs.
- Manual end-to-end against local Supabase (`supabase start`) + a dev GitHub
  App pointed at a tunnel (e.g. `smee.io`): open a PR through the normal
  agent flow, submit a changes-requested review with inline comments, and
  verify (1) status flips, (2) the composed message appears in the issue
  chat, (3) `run_status` becomes `queued`, (4) the worker resumes the session
  and pushes to the same branch, (5) redelivering the webhook from the App's
  "Advanced" tab does not duplicate the message or re-queue.
- Signature-verified curl replay of a captured payload for the
  `not_tracked`, `disabled`, and fetch-failure paths.

## Rollout

1. Ship the migration (additive, default-on toggle; no backfill needed).
2. Generate a private key for the GitHub App and set `GITHUB_APP_ID` /
   `GITHUB_APP_PRIVATE_KEY` in the web environment. Until they're set, the
   feature degrades to review-body-only messages (still functional).
3. Update `docs/github-app.md`: the new env vars, and note that the
   "pull request status automation" caveat in its intro is now partially
   superseded.

## Future extensions (explicitly deferred)

- Feed follow-up review-thread replies (`pull_request_review_comment`
  events) into an active conversation.
- React to CI failures the same way (shares the App-credential plumbing built
  here).
- Post a brief acknowledgment comment or resolve addressed threads on GitHub
  (requires Pull requests: Read **and write**).
- Per-issue auto-response cap / bot-reviewer filter.
