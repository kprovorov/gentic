# 6. Isolated reviewer runtime

Date: 2026-08-20

## Status

Accepted

## Context

GEN-413 (ADR-0004) built the Automatic Review lifecycle state machine and
GEN-414 (ADR-0005) built the host-facing claim/lease/heartbeat/reconcile
pipeline on top of it, but both deliberately left the reviewer runtime
itself unbuilt: `apps/gentic/src/host.ts`'s `processReviewRun` sent one
heartbeat and then reported every claimed review run as an infrastructure
failure, on purpose, so the pipeline could ship and be exercised end to end
before anything tried to produce a real verdict. GEN-415 replaces that stub
with a real reviewer agent run, launched as a process distinct from the
implementation agent, that can inspect and test the exact pull-request
revision but cannot modify or publish repository changes.

## Decision

**Isolation is a distinct directory, a scrubbed environment, and no MCP
server — not a container.** The implementation agent already runs with full
host-machine filesystem access; building genuine process/container
sandboxing for the reviewer would be a much larger undertaking than the
spec's own framing ("mechanically isolated") asks for. Instead: the
reviewer's disposable checkout lives at `review-{reviewRunId}`, a directory
that structurally cannot be the implementation issue's own `{issueId}`
checkout; its child process's `env` is `process.env` with every credential
capable of authenticating a `git push` or a credential-helper prompt removed
(`SSH_AUTH_SOCK`, `SSH_AGENT_PID`, `GIT_ASKPASS`, `GIT_SSH_COMMAND`,
`GIT_SSH`, `GH_TOKEN`, `GITHUB_TOKEN`) and `GIT_CONFIG_GLOBAL`/
`GIT_CONFIG_SYSTEM` pointed at `/dev/null` so a stray `credential.helper`
entry in the host's own gitconfig is never reachable either; and
no Gentic MCP server is attached at all, so the reviewer has no
mutation-capable channel to the issue tracker either. Local edits and test
runs inside the checkout are still permitted — "permit local inspection and
tests" — because the checkout is unconditionally discarded (`rm -rf`, in a
`finally` block covering both success and failure) once the run ends, and it
was never reachable from the implementation worktree in the first place.

**Credential removal is a denylist over `process.env`, not an allowlist.**
An allowlist would need to enumerate every environment variable the model
provider's auth and the ACP agent binary itself might need (API keys,
locale, proxy settings, `PATH` extensions, ...), none of which this host
can predict in advance; missing one would silently break the reviewer. A
denylist only needs to name the specific credentials capable of doing the
one thing isolation must prevent (pushing, or authenticating as the
GitHub App). GitHub App credentials specifically are never in `apps/gentic`'s
environment to begin with — only `apps/web` holds `GITHUB_APP_ID`/
`GITHUB_APP_PRIVATE_KEY` — so "cannot submit a GitHub review" holds
structurally, with nothing to strip.

**Structured output is enforced by parsing the reviewer's final message, not
by a bespoke MCP tool.** The reviewer is instructed to end its turn with
exactly one fenced ` ```json ` block matching `reviewerStructuredOutputSchema`
(`packages/validators/src/agent.ts`); `extractReviewerOutput`
(`apps/gentic/src/review-session.ts`) pulls out the last such block, parses
it, and validates it. A missing block, invalid JSON, or a schema failure all
throw `ReviewerOutputInvalidError`, which `processReviewRun` always routes to
`failReviewRun` — an infrastructure failure, never a fabricated verdict, per
the acceptance criteria. Building a dedicated local MCP server exposing a
`submit_review` tool was considered and rejected: it would be new protocol/
listener/auth infrastructure for the same outcome this achieves by parsing
plain text the agent already has to produce.

**The reviewer output schema forbids findings on an `approved` verdict.**
`reviewerStructuredOutputSchema` refines "verdict `approved` implies
`findings` is empty" — self-contradictory raw model output (approved, but
listing blocking findings) is treated the same as a malformed block: a
schema failure, hence an infrastructure failure, not silently accepted.

**The diff is computed locally against the disposable checkout; only PR
title/body/base are fetched from GitHub.** `apps/gentic/src/git.ts` gains
`cloneRepoAtSha` (fetches and checks out one exact commit, not a branch tip)
and `diffAgainstBase` (fetches the base commit too, then a plain two-commit
`git diff` — not a three-dot merge-base diff, since the two shallow fetches
share no history to derive a merge base from, but a straight tree comparison
is exactly what a reviewer needs to see "what changed"). `verifyHeadSha`
proves the checkout's `HEAD` equals the requested SHA before review begins,
throwing otherwise — the acceptance criterion this issue is built around.
PR title/body/base ref/base SHA aren't computable locally, so
`apps/web/lib/github-app.ts`'s `fetchPullRequestMetadata` (the one new
GitHub API call this issue adds) fetches them, reusing the existing
installation-token machinery; a lookup failure there degrades to nulls
(mirroring `resolvePrFinishStatus`'s existing fallback pattern) rather than
turning a transient GitHub hiccup into a review-blocking infrastructure
failure.

**The Review Run log sink is new, parallel plumbing, not a reuse of Issue
chat, and deliberately minimal.** A new `review_run_logs` table
(`review_run_id`, `seq`, `role`, `content` — no tool-call/event-type
machinery) plus a parallel realtime Broadcast topic (`review-run:{id}`,
authorized by its own `realtime.messages` RLS policies mirroring the
`issue:{id}` ones) is what `apps/gentic/src/review-session.ts` streams
into, one line per completed unit of output (a flushed text buffer, a tool
call) rather than the incrementally-throttled per-token streaming Issue
chat uses — a review run has no interactive, user-facing timeline to
animate, only an execution log to record.

**`review_findings` gains `evidence`/`impact`/`requested_change` as
additive, unconstrained columns.** Every finding the reviewer emits must
carry a defect, evidence, impact, and requested change (enforced by
`reviewerStructuredOutputSchema` and by `reviewFindingInputSchema`, the
`/complete` route's input contract), but the table itself adds no CHECK
requiring them — it stays caller-agnostic, mirroring ADR-0004's "additive
condition, not a rewrite" precedent, in case a future non-reviewer caller
populates `review_findings` differently.

**Provider/model resolution is a plain read, not a re-resolution.**
`issue_review_policies` (frozen at first-PR-association time, per the
automatic-review-configuration migration) already resolves "Same as Issue"
provider/model via `coalesce(project.automatic_review_provider, issue.
agent_provider)`. `packages/services/src/review-context.ts`'s
`getReviewRunContext` just reads that frozen row; no resolution logic exists
in `apps/gentic` at all.

## Consequences

- `apps/gentic/src/host.ts`'s `processReviewRun` now clones the exact SHA,
  verifies it, computes the diff, runs an isolated `runReviewerSession`, and
  routes the result to `completeReviewRun` (success) or `failReviewRun`
  (any failure, including an invalid structured output) — always discarding
  the disposable checkout in a `finally` block. A `setInterval` heartbeat
  runs for the duration of the session, not just once at the start, since a
  real reviewer session can run considerably longer than the stub did.
- A new agent-API route, `review-runs/[id]/context`, assembles and returns
  everything the reviewer needs (issue title/body/attachments, repo,
  reviewer provider/model/instructions, PR metadata and CI evidence) in one
  call; `review-runs/[id]/logs` persists one log line at a time; the
  existing `/agent/realtime/token` route now accepts either an issue-chat
  pair or a `review_run_id`, since the minted token itself is user-scoped
  rather than topic-scoped and only the RLS ownership check differs.
- User-facing rendering of Review Run logs remains out of scope, same as
  ADR-0004/0005 left it — this issue only builds the sink, not a viewer.
- Publishing the validated verdict to GitHub, and applying any requested
  fixes, remain explicitly out of scope, same as the original issue framed
  them.
