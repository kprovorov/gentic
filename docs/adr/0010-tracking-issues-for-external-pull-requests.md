# 10. Tracking Issues for pull requests no Issue produced

Date: 2026-08-29

## Status

Accepted

## Context

Automatic Review (ADR-0004 through ADR-0008) only ever reached pull requests
an agent opened. The reason is structural, not a missing feature flag: the
webhook associates a pull request by parsing its head branch for a canonical
Issue code (`GEN-42-...`, `parseCanonicalIssueBranch`), and a branch that
names no Issue is dropped with `outcome: "no_match"` before any review code
runs. GEN-432 asks for the opposite default — every pull request in a
Project's repository should be reviewed, however it got there: a hand-written
branch, a dependency bump, a teammate's work.

Everything downstream of that association is keyed on an Issue. The frozen
policy is `issue_review_policies.issue_id`; `review_cycles` carries both an
`issue_id` and a trigger asserting its pull request belongs to that same
Issue; `evaluate_review_eligibility`, `complete_review_attempt` and
`supersede_active_review_cycle` all lock the Issue row first and drive its
status; `claim_review_run` and `getReviewRunContext` read the Issue for the
reviewer's context; the timeline is `issue_events`. "Review a pull request
with no Issue" therefore means either teaching every one of those to work
with a null Issue, or giving the pull request an Issue.

## Decision

**A pull request that resolves to no Issue gets a *tracking Issue*** — an
ordinary `issues` row, created by the webhook in the Project that owns the
base repository, carrying the pull request's title and a body that says
plainly what it is. The association then proceeds exactly as it always has,
and every stage after it — policy snapshot, eligibility, cycles, claiming,
publishing, timeline, the recovery controls — works unchanged and unaware.

The alternative, making `review_cycles.issue_id` nullable and threading
"maybe there is no Issue" through the engine, was rejected: it doubles the
state space of the most concurrency-sensitive code in the product to model
something the tracker can represent as data instead. A tracking Issue is also
the honest answer to "where do I see that this pull request is being
reviewed?" — the same place as everything else.

`track_external_pull_request` creates the Issue and delegates to
`associate_pull_request_from_webhook`, under an advisory transaction lock on
the pull request URL. Without it, the `opened` and `synchronize` deliveries
for one new pull request both find no association and both create an Issue,
and only one can win the unique `issue_pull_requests.url` — leaving the
loser's Issue behind with no pull request at all.

**Tracking is a fall-through, never a widening of scope.** It runs only after
head-branch resolution fails, and declines unless all of:

- **Automatic Review is enabled on the Project** that owns the base
  repository. Nothing new opts in: the setting that decides whether an
  agent's pull requests are reviewed decides this too, and a Project with
  review off gets no tracking Issues at all. The RPC re-reads the setting
  under the same statement that creates the Issue, because that is the value
  `snapshot_issue_review_policy` is about to freeze — an Issue whose frozen
  policy says "disabled" would be permanent noise for a review that can never
  run.
- **The pull request is open and out of draft.** A draft cannot hold a review
  run at all (`ensure_review_run_pull_request_not_draft`), and a closed or
  merged pull request never will; tracking either only leaves an Issue
  behind. A draft marked ready arrives again as `ready_for_review` and is
  tracked then.
- **The head branch lives in the base repository, not a fork.** This is the
  one real security boundary the feature crosses. Reviewing means cloning the
  head commit onto the owner's host and letting a coding agent run the
  repository's tests against it; for a fork pull request that is an unvetted
  contributor's code executing on the owner's machine. The reviewer runtime's
  isolation (ADR-0006) scrubs push credentials, but it is not a sandbox
  against arbitrary code execution and was never designed to be.

**No path may put an agent to work on a tracking Issue.** It is created
`ready-for-review`, with `create_pr_automatically = false` and no session, so
no host claims it and it has no implementation owner — which is what makes
`deliver_review_fix_request` stop at `no_owner` (ADR-0007) instead of
delivering the automatic review's findings as a fix-turn.

That is not sufficient on its own. Three other paths re-queue an Issue to
`todo` from a webhook, and all three would otherwise fire on a tracking
Issue: `applyTestsFailed` (unconditionally, on red CI),
`applyChangesRequestedReview` and `applyPullRequestComment` (both gated only
on the Project's `auto_respond_to_reviews`). A red CI run on a teammate's
pull request would have started an agent run against it. The new
`issues.source` column (`user` | `external_pull_request`) is what those three
check; it exists for this reason, not for display. Deriving the same fact
from the absence of an implementation owner was rejected: Issues predating
ADR-0003 have no owner row either, and would have quietly lost their
human-review handback.

The upshot is that a tracking Issue is review-only. Findings reach the pull
request as a GitHub review — the human who opened it acts on them, pushes,
and the next cycle starts — and nothing is ever handed to an agent.

## Consequences

- Pull requests opened by hand, by a teammate, or by a bot on a same-repo
  branch are now reviewed, and appear in the tracker as Issues titled
  `PR #<n>: <pull request title>` that move through `Reviewing` → `Approved`
  / `Changes requested` and settle at `Merged` or `Cancelled` when the pull
  request closes, via the ordinary status aggregator.
- The reviewer is told, in the body it receives as "the original issue",
  that no specification stands behind the change and to review the pull
  request on its own terms — otherwise it would judge the diff against a
  description of itself.
- Fork pull requests remain untracked and unreviewed. Extending review to
  them needs an execution sandbox first, not a flag.
- A repository shared by two Projects resolves to the older one. There is no
  Issue code to disambiguate with here, unlike the head-branch path, so this
  is a deterministic choice rather than a correct one.
- `repository_out_of_scope` is no longer returned for a branch whose Issue
  code names a Project on a different repository: the base repository decides
  which Project a pull request belongs to, so that case now falls through to
  tracking. The reason survives for a pull request already associated with an
  Issue outside the installation's scope.
