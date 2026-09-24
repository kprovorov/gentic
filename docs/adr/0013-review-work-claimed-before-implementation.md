# 13. Review work is claimed before implementation work

Date: 2026-09-23

## Status

Accepted. Supersedes the "Implementation priority is enforced by claim
ordering on the host CLI" decision in ADR-0005; the rest of ADR-0005
(claiming RPC, lease, reconciliation, recovery paths) is unchanged.

## Context

ADR-0005 made implementation work always win capacity contention: every
poll tick the host called `claimNextQueuedIssue` first and only tried
`claimReviewRun` when no implementation issue was available. With a
backlog of `todo` issues on a host with a single slot, that produced
"implement 1, implement 2, implement 3, review 1, review 2, review 3": no
pull request was reviewed — and so none could be merged or have fixes
routed back to its implementation session — until the entire backlog had
been implemented.

That ordering optimised for starting new work. In practice a pull request
that is ready for review represents an issue that is almost done, and the
review is the only step between it and a merge (or a fix round). Leaving
it unreviewed while fresh issues are started from scratch delays every
finished issue by the whole remaining backlog, and keeps more issues
half-open at once.

## Decision

**A queued review run is claimed before any implementation issue, on every
poll tick.** `apps/gentic/src/host.ts` now calls `claimReviewRun` first and
only calls `claimNextQueuedIssue` when no review run was available. The
resulting schedule on a one-slot host with a backlog is "implement 1;
implement 2 while 1 is in CI; review 1 as soon as its run is queued;
implement 3; review 2; ...": something ready for review always goes first.

Everything else about ADR-0005 stands. Priority is still enforced purely
by client-side claim ordering — two sequential HTTP calls rather than one
combined atomic endpoint — and both job classes still share one capacity
pool per host via `listRunningTaskCounts`, which is what makes the ordering
bite: a successful review claim consumes the slot the issue claim would
have seen moments later. The narrow, accepted race is mirrored: a review
run queued in the gap between the two calls can lose one poll tick's slot
to an implementation claim.

Active implementation is still never paused or interrupted to start a
review. A review run only ever takes a *free* slot; with a full host it
waits for the next slot to open, and then wins it.

## Consequences

- `apps/gentic/src/host.ts` swaps the order of the two claim attempts; no
  API or database change is needed.
- Hosts with `MAX_CONCURRENT_ISSUES` of 1 now interleave implementation and
  review rather than draining the implementation backlog first. Hosts with
  more slots see the same effect whenever every slot is contended.
- A host that keeps receiving review runs (for example, a project with a
  very active pull-request stream from other contributors, each producing
  a tracking issue) can starve implementation work on that host. This is
  accepted for now: review runs are bounded by the three-attempt budget per
  cycle and are short-lived compared with an implementation run, and the
  product's promise is that finished work is reviewed promptly.
