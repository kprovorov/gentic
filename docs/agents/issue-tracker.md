# Issue tracker: Gentic (dogfooded)

Issues and PRDs for this repo live in the Gentic app itself — this repo is the product, and its own backlog is tracked as a Gentic project. Use the `mcp__gentic__*` MCP tools for all operations (already connected in this session).

- **Project**: `Gentic` (key `GEN`), id `7d15165c-b9d7-4d83-aa62-0d73b072573c`, repo `kprovorov/gentic`. Always pass this id as `project_id`. (There is a second project, `Greenline`, but it belongs to a different repo — ignore it here.)

## Conventions

- **Create an issue**: `mcp__gentic__create_issue` with `project_id` above, a `title`, and a `body` (the detailed instructions/spec). Defaults to `type: feature`, `status: draft`, `priority: medium`. Create as `draft` unless you intentionally want it to enter another workflow state.
- **Read an issue**: `mcp__gentic__get_issue` by its Issue Code (e.g. `GEN-123`).
- **List issues**: `mcp__gentic__list_issues` with `project_id` set to the id above.
- **Update title/spec/type/priority**: `mcp__gentic__update_issue`. There is no separate comment thread — the `body` field *is* the living spec, so append updates to it (e.g. a `--- update <date> ---` marker line) rather than expecting a comments API.
- **Change priority only**: `mcp__gentic__update_issue_priority`.
- **Change workflow status**: `mcp__gentic__update_issue_status`.
- **Close as won't-fix**: set status to `cancelled` via `update_issue_status`. There's no reason field — put the reason in the `body` before cancelling if it needs to be preserved.

### Important gotcha: `todo` is not just a label

Gentic's status enum (`draft → todo → queued → held → in-progress → waiting-for-input → testing → tests-failed → ready-for-review → changes-requested → approved → merged → deploying → deploy-failed → validating → run-failed → completed`, with `cancelled` reachable from most states) drives a real state machine, not a freeform label set:

- `draft` = created, not yet handed to an agent.
- Moving status from `draft` to `todo` **starts a background coding-agent run immediately** (it claims the issue, seeds the kickoff message `Work on Gentic issue {Issue Code}.` — the agent reads the `body` itself via the Gentic MCP `get_issue` tool — and a worker begins work). Never do this just to mean "ready-for-agent" as a passive label — only do it when you actually want the agent to start now.
- `held` is a system-imposed pause (agent hit a usage/rate limit), not a manual "waiting on human" state — don't use it for triage purposes.
- An issue has no assignee field. Its fields are `status`, `type`, `priority`, `body`/`title`, plus account-scoped **Labels** — reusable, passive classifications managed with the `mcp__gentic__*` Label tools (`list_labels`, `create_label`, `add_issue_labels`, `remove_issue_labels`, …). Labels never change status, priority, or workflow and never start an agent. See `docs/agents/triage-labels.md` and `docs/web/labels.mdx`.

## When a skill says "publish to the issue tracker"

Create a Gentic issue with `mcp__gentic__create_issue`, status `draft`.

## When a skill says "fetch the relevant ticket"

`mcp__gentic__get_issue` with the Issue Code, e.g. `GEN-123` (or `list_issues` + filter by title if only given a human-readable reference).

## Wayfinding operations

Used by `/wayfinder`. Gentic has no parent/child relation — only pairwise `blocking`/`blocked_by` (`mcp__gentic__add_issue_relation`, `list_issue_relations`, `list_issue_relation_candidates`, `delete_issue_relation`) — so map/child grouping is by convention, not a first-class link.

- **Map**: a Gentic issue titled `[Map] <effort>`, `type: idea`, holding the Notes / Decisions-so-far / Fog content in `body`. Keep it in `draft` — never promote a map issue to `todo`.
- **Child ticket**: a Gentic issue titled `[<effort>] <ticket title>`, `body` starting with `Part of: <map issue title>`. A leading line in `body` records ticket type (`research`/`prototype`/`grilling`/`task`).
- **Blocking**: `mcp__gentic__add_issue_relation` with `direction: "blocked_by"` from the child to its blocker. A ticket is unblocked when every blocker relation returned by `list_issue_relations` is on an issue with status `completed` or `cancelled`.
- **Claim**: for a human-driven wayfinder ticket (research/prototype/grilling), do **not** move it to `todo` — that launches the autonomous agent. Instead record the claim as a line in `body` (e.g. `Claimed by: <name>`) and leave status in `draft`. Only use `task`-type tickets with real `todo` status if the ticket is meant to be run by the Gentic agent itself.
- **Resolve**: append the answer to `body` under an `## Answer` heading, set status to `completed`, then append a context pointer to the map issue's `body` under Decisions-so-far.
