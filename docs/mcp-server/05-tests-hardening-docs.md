# Add tests, hardening, and user docs for the MCP server

## Context

Gentic is a pnpm/Turborepo monorepo (`apps/web` is the Next.js App Router
app; `packages/*` holds shared code including `@gentic/supabase` and
`@gentic/validators`). It exposes an MCP (Model Context Protocol) server so
third-party AI agents can connect on a user's behalf via Clerk OAuth and
manage that user's "issues" (dev tasks run by a background coding agent)
and "projects" (git repos), including reading/continuing an issue's chat
conversation. As of this task being written, there are no automated tests
anywhere in this monorepo — no `vitest.config.*`, `jest.config.*`, or
`*.test.ts`/`*.spec.ts` files exist. Confirm that's still true before
assuming any test infrastructure is already in place.

The business logic backing the MCP tools (issue/project CRUD, and
specifically the status-transition side effects — moving an issue from
`draft` to `todo` queues a background run and seeds a kickoff message;
sending a message on a finished issue re-queues it) lives in a plain,
framework-agnostic service layer under `apps/web/lib/services/` and is
exactly the kind of logic that's cheap to unit test and easy to regress
silently. This task introduces test coverage for it, adds integration-level
coverage of the MCP tools themselves, and covers documentation/operational
loose ends around shipping a public, OAuth-authenticated endpoint.

## Prerequisites — verify these exist in the codebase before starting

- A service layer at `apps/web/lib/services/issues.ts` and `projects.ts`
  with functions like `createIssue`, `updateIssue`, `deleteIssue`,
  `updateIssueStatus`, `sendIssueMessage`, `listIssues`, `getIssue`, and
  their `projects.ts` equivalents, each taking a Supabase client and a
  Clerk `userId` explicitly and throwing a typed error (something like
  `ServiceError` with a `code`) on ownership failures.
- An MCP server at `apps/web/app/api/mcp/route.ts` (via `mcp-handler` +
  Clerk OAuth verification via `@clerk/mcp-tools`) registering tools for
  project/issue CRUD and issue messages (`list_projects`, `list_issues`,
  `get_issue`, `create_issue`, `update_issue`, `delete_issue`,
  `update_issue_status`, `list_issue_messages`, `add_issue_message`).

If either is substantially missing, this task can't proceed as scoped —
report that rather than building the missing feature work yourself.

## Read first

- The full `apps/web/lib/services/` directory and `apps/web/app/api/mcp/`
  directory as they actually exist in the repo.
- `turbo.json` and the root `package.json`, plus each `packages/*/package.json`
  and `apps/*/package.json`, for the existing `lint`/`typecheck` script
  conventions — a new `test` script should follow the same per-package +
  turbo-pipeline pattern already used for those, not a bolted-on one-off.
- `supabase/config.toml` (if present) and any README mentioning a local
  Supabase dev setup — check whether a documented local test database
  already exists before building a mocked Supabase client from scratch for
  unit tests.

## Requirements

1. **Introduce a test runner.** Vitest is a reasonable default for this
   stack (ESM monorepo, plain TS + Next.js server code, no need for the
   extra config Jest requires in this setup) — confirm this reasoning holds
   for what's actually in the repo rather than taking it on faith. Add it
   as a shared dev dependency, wire a `test` script into `turbo.json`'s
   pipeline, and add per-package `test` scripts starting with `apps/web`
   and `packages/validators`.

2. **Unit tests for the issue/project service layer**, covering at least:
   - Ownership enforcement: a service-role-client call for a resource
     belonging to a different `userId` throws the typed not-found error and
     never returns the row.
   - The `draft -> todo` status transition sets `run_status: "queued"` and
     inserts exactly one kickoff message with the expected content.
   - Any other status transition does *not* touch `run_status` or insert a
     message.
   - Sending a message re-queues the issue only when its current
     `run_status` is `completed`/`failed`/`cancelled`, and leaves it alone
     otherwise (e.g. while `running`).
   - Use a fake/mocked Supabase client, or a local Supabase test instance
     if one is already set up for this repo (see "Read first") — don't run
     these tests against a real/shared project database.

3. **Integration test (or a documented manual test script if an in-process
   MCP client harness proves impractical) for the MCP tools**: drive the
   actual `/api/mcp` route with a real or stubbed authenticated request per
   tool, asserting on tool output shape and cross-user isolation (a second
   simulated user must never see or modify the first user's data).

4. **User-facing docs**: a short `docs/mcp-server/connecting.md` explaining
   how a Gentic user connects an MCP client (Claude, Cursor, etc.) to their
   account — what URL to point the client at, what to expect during the
   OAuth consent step, and how to revoke access afterward. Check what
   revocation surface the Clerk OAuth Applications dashboard actually
   exposes (e.g. can the end user revoke a connected app themselves, or
   only a Gentic admin) before writing this, since that materially affects
   what the doc can promise.

5. **Flag, don't necessarily build, these follow-ups** — call them out
   explicitly in the PR description so they're not silently forgotten:
   - Rate limiting on `/api/mcp` — there is none anywhere in the app today,
     and a public MCP endpoint is a more attractive abuse target than the
     existing browser-only UI.
   - Whether the internal worker's API
     (`apps/web/app/api/v1/agent/**`) should also be migrated onto the
     shared service layer for consistency — optional cleanup, not required.
   - Scoped/read-only OAuth tokens, if Clerk's OAuth Applications support
     custom scopes — not needed for a first version where every
     authenticated connection gets full CRUD, but worth knowing whether
     it's available before a "read-only agent" use case comes up.

## Out of scope

- No new product features — this task is test coverage, docs, and an
  explicit written record of what's deliberately deferred.

## Acceptance criteria

- `pnpm test` (or the equivalent turbo-piped command) runs and passes.
- Each service-layer behavior listed above is covered by at least one test
  that fails if the behavior is broken (verify this by briefly breaking
  each one and confirming the test catches it, then reverting).
- `docs/mcp-server/connecting.md` exists and accurately reflects the actual
  OAuth consent/revocation UX as built, not an assumed/idealized version of
  it.
