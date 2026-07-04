# T3 — MCP tools: projects & issues CRUD

## Depends on

T1 (shared service layer) and T2 (Clerk OAuth + MCP scaffold with a working
`whoami` tool). Both must be merged/available before starting this task.

## Why

This is the actual feature: let an authenticated MCP client list/create/
update/delete issues (and the projects they belong to) via the tools
registered on the `/api/mcp` route built in T2, using the service functions
built in T1.

## Read first

- `apps/web/lib/services/issues.ts` and `projects.ts` (from T1) — these are
  the only place tool handlers should touch Supabase. If a needed operation
  doesn't exist there yet, add it to the service layer, don't query Supabase
  directly from the MCP route.
- `apps/web/app/api/mcp/route.ts` and however T2 wired token verification —
  reuse the same "resolve token → Clerk userId" helper for every tool, and
  the same service-role Supabase client (`@gentic/supabase/service`) already
  used by `apps/web/app/api/v1/agent/_lib.ts`.
- `packages/validators/src/issues.ts` and `projects.ts` (from T1) — reuse
  these zod schemas as the MCP tool input schemas (`mcp-handler` /
  `@modelcontextprotocol/sdk` tool registration takes a zod schema directly
  for `inputSchema`) instead of redefining shapes.
- `apps/web/app/api/v1/agent/_lib.ts` — `ApiError`/`handleAgentError` for
  the error-shape convention already established for this app's non-UI
  APIs; decide whether MCP tool errors should reuse `ServiceError` from T1
  mapped to MCP's own error content shape (`isError: true` result), which is
  the more idiomatic MCP pattern — don't invent a third error convention.

## Requirements

1. **Tools to register** on the MCP server from T2, each backed by the T1
   service functions and T1/`@gentic/validators` schemas for input
   validation:
   - `list_projects` — no input; returns the caller's projects.
   - `list_issues` — input: optional `project_id`; returns issues (consider
     whether to return all fields or a trimmed summary — check what an
     agent actually needs: id, project_id, title, status, run_status,
     created_at/updated_at at minimum).
   - `get_issue` — input: `id`; returns full issue detail.
   - `create_issue` — input matches `createIssueSchema` (project_id, title,
     prompt?, status?).
   - `update_issue` — input matches `updateIssueSchema` (id, title, prompt?).
   - `delete_issue` — input: `id`.
   - `update_issue_status` — input: `id`, `status`. This must go through
     `updateIssueStatus` in the service layer so the draft→todo run-queueing
     side effect fires exactly like it does from the UI — don't bypass it
     with a raw update.

2. **Every tool handler**:
   - Resolves the Clerk `userId` from the verified token (via whatever T2
     exposed — likely a small helper you can lift out of the `whoami` tool
     into a shared function callable from every tool handler).
   - Calls the matching T1 service function with `(supabase, userId, ...)`.
   - Maps a thrown `ServiceError` to an MCP tool error result (`isError:
     true`, message from `error.message`) rather than letting it throw
     unhandled through `mcp-handler`.
   - Returns tool output as MCP `content` (structured JSON via
     `structuredContent` if the SDK/mcp-handler version in use supports it,
     otherwise a JSON-stringified text block — check what T2's SDK version
     supports before choosing).

3. **Tool descriptions**: write clear, agent-facing `description` strings
   and per-field descriptions on the zod schemas (these are what the
   calling AI agent reads to decide how to use the tool — vague
   descriptions like "the id" are not acceptable, say what kind of id and
   where to get it, e.g. "the issue id, from list_issues or get_issue").

4. **Decide and document, in the tool descriptions, the issue status state
   machine** the agent should respect — at minimum, tell the agent which
   `status` transitions are meaningful (e.g. don't let a naive agent set an
   arbitrary status value out of the 14 in `issueStatusSchema` without
   understanding that `draft -> todo` specifically kicks off a background
   run). This is documentation/UX, not new validation logic — the actual
   enum enforcement already happens via the zod schema.

## Out of scope

- Issue messages/chat (T4).
- Any change to `apps/web/app/api/v1/agent/**` — that internal API is
  unaffected by this task; it's fine (expected, even) that its logic now
  duplicates less with the UI thanks to T1, but migrating those routes onto
  the T1 service layer is optional cleanup, not required for this task's
  acceptance.

## Acceptance criteria

- From a connected MCP client (same connection method used to verify T2),
  successfully: list projects, create an issue in one, list issues for that
  project, get it by id, update its title, transition it draft→todo and
  confirm (via the Supabase dashboard or the Gentic UI) that `run_status`
  became `queued` and a kickoff message exists, then delete the issue.
- Attempting any of the above against another user's project/issue id
  (test with a second Clerk account / a second OAuth-authorized session)
  returns a not-found-style tool error, not another user's data and not an
  unhandled exception.
- `pnpm --filter @gentic/web typecheck` and `lint` pass.
