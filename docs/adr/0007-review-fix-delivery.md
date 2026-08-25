# 7. Returning review findings to the original implementation session

Date: 2026-08-25

## Status

Accepted

## Context

The Automatic Review lifecycle engine (ADR-0004) records a `changes_requested`
Review Attempt, but nothing turned that verdict into work: no fix-turn ever
reached the agent, so the Issue sat at `changes-requested` until a human
intervened. Two prior pieces of infrastructure exist specifically to make this
possible but were not yet wired together: `issue_implementation_owners`
(ADR-0003) durably records which worker/session produced the pull request, and
`complete_review_attempt` (ADR-0004) already returns the exact Review Attempt,
its cycle, and the Issue the moment a verdict is recorded.

The existing precedent for "feed feedback back into the same conversation" is
`applyChangesRequestedReview` (`packages/services/src/issues/chat.ts`): insert
a `gentic`-authored user message, then flip the Issue from
`changes-requested` back to `todo`. That path exists for a *genuine human*
GitHub review — it reads a webhook payload, and is deliberately never called
for our own automated review being echoed back (`isKnownReviewAttempt`). The
automatic path needed the same delivery shape, sourced from
`review_findings` instead, and — critically — needed its own validation before
delivering: the owner must still be resumable, the pull request's head must
not have moved since the verdict was produced, and the cycle must still be
`active` (not exhausted at the third attempt, not superseded by a human review
racing in first).

## Decision

**One new RPC, `deliver_review_fix_request`, is the sole gate a
`changes_requested` verdict passes through before it becomes a fix-turn.**
Called from `completeReviewRun` (`apps/web/app/api/v1/agent/review-runs/[id]/
complete/route.ts`) immediately after `completeReviewAttempt`, gated by
`shouldDeliverReviewFix` (accepted, verdict `changes_requested`, cycle still
`active`). It runs entirely server-role-side, locking the Issue and the
Review Attempt's cycle in the same order `evaluate_review_eligibility` and
`supersede_active_review_cycle` already use, so it can never deadlock against
either — including the exact race that matters most: a genuine human
changes-requested review superseding the cycle at the same moment.

Every non-delivery outcome is a **stop condition, not an error** — the RPC
returns a stable outcome string (`already_delivered`, `cycle_not_active`,
`stale_head`, `no_owner`, `owner_unavailable` with a reason) rather than
throwing, and the Issue is left exactly where `complete_review_attempt` put
it. Concretely:

- **Idempotent by construction.** `messages.review_attempt_id` (a new column,
  uniquely indexed per Issue like the existing `github_review_id` /
  `github_comment_id` columns) is the dedupe key — replaying the same Review
  Attempt (a retried webhook, a duplicate `complete` call) never queues a
  second fix-turn.
- **Stale heads are rejected**, not silently applied: if the pull request's
  head has moved past the cycle's `head_sha` between the verdict completing
  and delivery running, delivery is skipped.
- **Only the current, resumable owner receives the delivery.** The RPC
  re-derives resumability the same way `resolveImplementationOwner`
  (`packages/services/src/issues/implementation-owner.ts`) does —
  `provider_changed`, `session_missing`, `worker_deleted`, `worker_banned` —
  deliberately duplicated in SQL rather than shared, since this must be
  atomic with the message insert and status flip, not a separate read. An
  unavailable owner is a stop condition: the Issue stays at
  `changes-requested`, with the specific reason recorded for a future
  recovery UI (ADR-0003's `unavailableReason`) to act on. No replacement
  session is ever created here.
- **The third changes-requested attempt requires human action.** Once
  `complete_review_attempt` marks the cycle `exhausted`, this RPC's
  `cycle_not_active` check stops delivery — the same check that also stops a
  human-superseded cycle, since both leave the cycle non-`active`.
- **Delivery is a single, gentic-authored user message and a `changes-
  requested` → `todo` status flip** — reusing the exact shape
  `applyChangesRequestedReview` and `applyTestsFailed` already use, so the
  ordinary claim + pending-messages plumbing (unchanged) picks it up. The
  content itself (`formatReviewFixRequestMessage`,
  `packages/services/src/issues/chat.ts`) is composed in TypeScript from the
  attempt's findings before the RPC call, not inside the transaction — the
  findings are immutable once `complete_review_attempt` inserts them, so
  there is no correctness reason to read them under the same lock.
- **Delivery is audited** on the Issue timeline via a `review_fix_delivered`
  `issue_events` row, alongside the existing `status_changed` /
  `pr_opened` events other lifecycle transitions already log.

## Consequences

- Findings return to the same agent session that produced the pull request,
  with no new session created unless a human explicitly triggers
  `start_fresh_implementation` (ADR-0003) — satisfying the product
  requirement that automatic review never silently replaces the
  implementation agent.
- Automatic fix/review looping is bounded (three attempts, ADR-0004) and a
  human review always wins a race against a pending automatic handoff,
  because both are gated by the identical `cycle.state = 'active'` check
  under the same row lock.
- **Deliberately out of scope, building on this**: routing the Issue *claim*
  itself to the owning worker specifically (today, any eligible worker can
  claim a re-queued Issue — a pre-existing property of the claim path shared
  by every resumption flow, not unique to review fixes) and the recovery UI
  that surfaces an unavailable owner's reason code. Both remain future work
  (tracked under the Automatic Review hardening/UI follow-ups, ADR-0003's own
  "Consequences").
