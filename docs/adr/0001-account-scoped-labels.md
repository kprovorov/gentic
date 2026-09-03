# 1. Account-scoped Labels

Date: 2026-08-05

## Status

Accepted

## Context

Gentic issues could not carry reusable classification metadata. Users leaned on
workflow `status`, issue `type`, `priority`, or ad-hoc title prefixes to group
work — but each of those fields already has a distinct meaning, and some carry
side effects (moving an issue to `todo` starts an agent run). That made
cross-project triage, filtering, and agent-driven organization inconsistent and
occasionally unsafe.

We needed a first-class **Label** that classifies issues without touching
workflow or agent execution, and a single ownership boundary for the catalog.
The two candidate boundaries were **project-scoped** catalogs (one taxonomy per
repository) and **account-scoped** catalogs (one taxonomy per authenticated
Account, shared across every project that Account owns).

The current authenticated ownership boundary is the **Account**, backed by the
existing Clerk `user_id`. There is no separate organization or team entity in
this scope.

## Decision

Labels are owned by the authenticated **Account** and may be assigned to issues
in **any project that Account owns**. There is no project-scoped catalog.

- A Label is a canonical product term (avoid "tag" or free-form label). It
  stores a stable `id`, the owner `user_id`, a display `name`, a canonical
  `color`, a lifecycle `state`, and timestamps. Assignments are a separate
  many-to-many relation (`issue_labels`) between issues and Labels.
- **Ownership is enforced at the database boundary.** Both `labels` and
  `issue_labels` have row-level security enabled. A Label row is readable and
  mutable only by the Account whose `user_id` matches the JWT `sub`. An
  assignment additionally requires that the issue and the Label share that same
  Account (the issue's owner is resolved through `issues → projects.user_id`);
  a trigger re-checks the same invariant so trusted service-role code cannot
  bypass it.
- **Names are unique case-insensitively per Account**, across both active and
  archived Labels, via a generated `name_key = lower(name)` column with a
  `unique (user_id, name_key)` constraint. Display casing is preserved. Names
  are trimmed, 1–50 characters, allow Unicode and internal spaces, and reject
  control characters.
- **Colors are stored canonically as opaque `#RRGGBB`** (uppercased). A 48-color
  accessible preset palette is offered; when no color is supplied, one of the
  least-used preset colors across the Account's active Labels is chosen. The UI
  computes readable foreground styling.
- **Catalogs are bounded.** Each Account is capped at **100 active Labels**
  (archived Labels do not count); each issue is capped at **20 active Label
  assignments**; a single user-driven bulk assignment request covers at most
  **100 issues**.
- **Labels are passive metadata.** They never change status, priority, workflow
  transitions, host selection, agent scheduling, kickoff prompts, or stored
  sessions, and they are never synchronized to GitHub.
- The catalog is reachable through both the web app and the Gentic MCP server,
  which resolve to the same Account and therefore the same catalog.
- A new Account starts with **no Labels**; Gentic imposes no default taxonomy.

## Consequences

- One taxonomy serves an Account's entire backlog, so users do not duplicate the
  same vocabulary per repository. This is the right default for the current
  single-Account ownership model.
- Because ownership lives in the database (RLS plus a scope trigger), both
  RLS-backed user code and manually-authorized service-role code (agent API, MCP
  handler) are protected against cross-account reads and writes.
- Account-wide uniqueness means a Label identity is unambiguous across projects,
  which is what makes stable-ID mutation, cross-project bulk changes, and the
  archive/restore lifecycle (see [ADR 0002](0002-label-archive-and-implicit-restore.md))
  coherent.
- Team/organization ownership, project-scoped catalogs, Label descriptions,
  manual ordering, and issue sorting by Labels are explicitly out of scope. If a
  shared-ownership model is introduced later, this decision must be revisited.
