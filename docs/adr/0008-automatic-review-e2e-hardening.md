# 8. Automatic Review end-to-end hardening test harness

Date: 2026-08-25

## Status

Accepted

## Context

GEN-411 through GEN-419 built the complete Automatic Review feature — the
lifecycle engine, host claiming, isolated reviewer runtime, GitHub
publishing, fix delivery, and recovery UI (ADRs 0003–0007) — before it is
turned on for users. GEN-420 asks to prove the whole thing under real event
ordering, concurrency, host failure, and GitHub retry conditions first.

Two test tiers already existed. pgTAP (`supabase/tests/*.sql`) runs against
real local Postgres and proves the SQL state machine directly, but its
"two hosts cannot claim the same job" coverage
(`review_run_claiming_test.sql`) is two *sequential* RPC calls inside one
transaction — it proves the end state is correct, not that the `for update
skip locked` guarantee holds under a genuine concurrent race. The
TypeScript unit tier (`node --test`, dependency-injected fakes) proves
route/service logic, but every test in it fakes `supabase.rpc()` entirely —
none of them exercise the real webhook route and the real Postgres engine
together. That gap is exactly the issue's first acceptance criterion:
"Tests exercise production transaction and webhook paths rather than only
helper functions." Several ADRs also flagged specific race windows as
*accepted but untested*: ADR-0004's human-review-vs-bot-echo distinction,
and ADR-0005's implementation-priority claim-ordering window ("one poll
interval of exposure").

## Decision

**A third tier drives real Postgres and the real route/service functions
directly, faking only GitHub's API and the reviewer subprocess** — the two
genuinely external boundaries ADR-0004/0006 already isolated behind
injectable seams (`pullRequestStateFetcher`, `PublishReviewVerdictDeps`,
`ProcessReviewRunDeps`). `apps/web/tests/automatic-review-e2e-lifecycle
.test.ts` and `automatic-review-e2e-races.test.ts` call
`handleGithubWebhookRequest`, `claimNextReviewRun`, and the
`review-lifecycle`/`github-integrations` service functions with a real
`createServiceClient()` pointed at a local Supabase instance — no mock
Postgres, no fake RPC responses. Publishing to GitHub itself
(`publishReviewVerdict`) is deliberately not exercised at this tier; it
requires a live GitHub App installation token that a test environment
can't produce, and it already has thorough dependency-injected coverage in
`review-publishing.test.ts`. This tier starts one layer below it —
`completeReviewAttempt` — the same contract `completeReviewRun` calls
after publishing succeeds.

**Concurrency is expressed as genuinely parallel service-client calls
(`Promise.all` over two independent client instances), not pgTAP +
`dblink`.** A pgTAP transaction can hold only one session's locks at a
time, so proving a real race requires either a second raw connection
(`dblink`, holding a lock open across statements) or two real, separate
HTTP requests racing on the same Postgres rows — which is also a more
faithful model of how these races actually happen in production (two
hosts polling independently, or GitHub redelivering a webhook while a
host's request is still in flight), and needs no new Postgres extension.

**This tier skips itself, rather than failing, when no live Supabase
instance is reachable.** `liveTest` (`apps/web/tests/helpers/
live-review-harness.ts`) checks for `SUPABASE_URL`/`NEXT_PUBLIC_SUPABASE_URL`
and `SUPABASE_SECRET_KEY` and marks every test in these files skipped with
a one-line reason if they're absent, so `pnpm test` stays green in any
environment without Docker/`supabase start` — including plain local
development — while CI (which already runs `supabase start` before `pnpm
test`) gets full coverage by exporting those two variables from `supabase
status -o env` right before the test step.

**Cleanup deletes by tracked id, bottom-up, rather than relying on FK
cascade.** Each seed helper records the ids it inserted; `cleanupSeeded`
deletes child tables (review runs, attempts, findings, logs) before parent
tables (pull requests, issues, projects) explicitly. This is more code than
trusting cascade delete, but it doesn't silently rot if a future migration
changes a table's `on delete` behavior, and it keeps every test file
self-contained (no shared fixture data to leak between runs).

## Consequences

- Ten lifecycle scenarios and three concurrency scenarios exist as living
  documentation of the acceptance criteria: policy snapshot immutability,
  the full happy path, 3-attempt exhaustion and fresh-cycle-after-push,
  infra-failure retry budgets, fix delivery to the original session,
  duplicate/reordered webhook convergence, multi-PR gating, and the two
  previously-untested race windows (claim contention, human-review-vs-
  automatic-approval).
- One test (`an Issue with two associated pull requests should not reach
  approved until both review cycles are approved`) documents a real gap
  found while writing this tier: `complete_review_attempt` calls
  `set_issue_status_from_review` with `'approved'` unconditionally on a
  single cycle's verdict, without checking sibling pull requests' cycle
  state the way `recompute_issue_status_from_pull_requests` (the generic
  PR-state aggregator) does. This was found by reading the engine SQL, not
  by running the test against a live database — the sandbox this tier was
  built in has no Docker — so it is flagged here rather than silently
  patched. Fixing it is future work: the `'approved'` branch needs the same
  all-reviewable-PRs-approved condition the aggregator already enforces.
- `.github/workflows/ci.yml`'s "Root tests" step gained one new step
  exporting local Supabase credentials; `apps/web/.env.example` documents
  the same two variables for local opt-in.
- `supabase/tests/review_run_reconciliation_test.sql` gained one scenario
  proving the property the file's existing coverage stopped short of: a
  reconciled run's automatic retry is actually claimable again once the
  crashed host (or its replacement) comes back online, not just marked
  failed.
