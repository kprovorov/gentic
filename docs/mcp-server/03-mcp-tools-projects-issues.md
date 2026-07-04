# Build MCP tools for project & issue CRUD

## Context

Gentic is a pnpm/Turborepo monorepo. `apps/web` is a Next.js (App Router)
app managing "issues" (dev tasks executed by a background coding agent)
grouped under "projects" (each project wraps a git repo), using Clerk for
auth and Supabase for data. Gentic exposes an MCP (Model Context Protocol)
server so third-party AI agents can connect on a user's behalf, authenticate
via Clerk OAuth (not the separate Clerk API Key mechanism used internally by
`apps/web/app/api/v1/agent/**`, which this task does not touch), and manage
that user's issues. This task adds the actual issue/project CRUD tools to
that MCP server.

## Prerequisites — verify these exist in the codebase before starting

This task assumes two pieces of infrastructure already exist. Check for
them first; if either is missing, treat building the minimal version
described below as a blocking prerequisite before writing any tools (flag
this expansion of scope explicitly rather than silently absorbing it).

1. **A plain, framework-agnostic service layer** at
   `apps/web/lib/services/issues.ts` and `apps/web/lib/services/projects.ts`,
   each function taking a Supabase client and a Clerk `userId` explicitly
   (no `"use server"`, no reliance on a Clerk session) and enforcing
   ownership itself rather than relying on RLS — because the Supabase client
   used by MCP tools will be a service-role client that bypasses RLS
   entirely. Expected functions:
   - `projects.ts`: `listProjects(supabase, userId)`, `getProject(supabase,
     userId, id)`, `createProject(supabase, userId, input)`,
     `updateProject(supabase, userId, id, input)`, `deleteProject(supabase,
     userId, id)`.
   - `issues.ts`: `listIssues(supabase, userId, filters?: { projectId?:
     string })`, `getIssue(supabase, userId, id)`, `createIssue(supabase,
     userId, input)`, `updateIssue(supabase, userId, id, input)`,
     `deleteIssue(supabase, userId, id)`, `updateIssueStatus(supabase,
     userId, id, status)` (this one has a side effect: transitioning an
     issue from `draft` to `todo` sets `run_status: "queued"` and inserts a
     kickoff message so a separate background worker picks up the issue —
     don't reimplement this by hand in a tool, always go through this
     function so the side effect fires correctly).
   - Every function throws a typed error (something like `ServiceError`
     with a `code` such as `"not_found"`) when the row doesn't exist or
     isn't owned by `userId` — map this to an MCP tool error, don't let it
     throw unhandled.
   - Since the `issues` table has no `user_id` column of its own, ownership
     is enforced via a join to `projects`
     (`.select("id, projects!inner(user_id)").eq("projects.user_id",
     userId)`) — if you need to build this layer yourself, use this join
     pattern, and get exact table/column names from
     `supabase/migrations/*.sql`, not from guessing.
   - Validation schemas for these inputs should live in
     `packages/validators` as zod schemas (e.g. `packages/validators/src/issues.ts`
     exporting `createIssueSchema`, `updateIssueSchema`,
     `updateIssueStatusSchema`, and the full issue status enum;
     `packages/validators/src/projects.ts` exporting `projectSchema`),
     exposed via `package.json` subpath exports (e.g. `"./issues"`,
     `"./projects"`) following whatever pattern already exists there (check
     `packages/validators/package.json`).

2. **An authenticated MCP endpoint** at `apps/web/app/api/mcp/route.ts`,
   built with `mcp-handler` (Vercel's Next.js App Router adapter for MCP's
   Streamable HTTP transport) and Clerk OAuth token verification via
   `@clerk/mcp-tools`, plus a `.well-known/oauth-protected-resource` route
   for OAuth discovery. There should already be a small, reusable helper
   function that resolves a verified request to a Clerk `userId` — reuse it
   for every tool added in this task; don't re-implement token verification
   per tool. If this scaffold doesn't exist yet, its full requirements are:
   register a Clerk OAuth Application (Dashboard, with Dynamic Client
   Registration enabled — a manual step, document it since it can't be
   captured in a diff), add `mcp-handler` + `@clerk/mcp-tools` +
   `@modelcontextprotocol/sdk` as dependencies of `apps/web`, and wire the
   route so unauthenticated/invalid-token requests return a spec-compliant
   `401` + `WWW-Authenticate` challenge (use `@clerk/mcp-tools`'s helper for
   this rather than hand-rolling the header format). Also check
   `apps/web/proxy.ts` (the Clerk middleware, Next 16 renamed
   `middleware.ts`) to ensure `/api/mcp` and the `.well-known` route aren't
   intercepted by session-redirect logic meant for browser pages.

## Read first

- Whatever files satisfy the two prerequisites above.
- `apps/web/app/api/v1/agent/_lib.ts` — for the `ApiError` /
  error-to-response convention already established in this app's non-UI
  APIs (reference only; don't modify this file). Decide whether your
  service-layer error type maps cleanly to an MCP tool error result
  (`isError: true`, message text) — that's the idiomatic MCP pattern, don't
  invent a third error convention.
- `supabase/migrations/*.sql` — source of truth for exact `issues` and
  `projects` table columns and the full issue status enum.

## Requirements

1. **Tools to register**, each backed by the service-layer functions and
   zod schemas from the prerequisites:
   - `list_projects` — no input; returns the caller's projects.
   - `list_issues` — input: optional `project_id`; returns issues (id,
     project_id, title, status, run_status, created_at, updated_at at
     minimum — decide if agents need more fields than that).
   - `get_issue` — input: `id`; returns full issue detail.
   - `create_issue` — input: project_id, title, prompt?, status?.
   - `update_issue` — input: id, title, prompt?.
   - `delete_issue` — input: id.
   - `update_issue_status` — input: id, status. Must call the service
     layer's `updateIssueStatus` so the draft→todo run-queueing side effect
     fires exactly like it does from the Gentic web UI — never issue a raw
     status update that bypasses it.

2. **Every tool handler**:
   - Resolves the Clerk `userId` from the verified token using the shared
     helper from the MCP scaffold (prerequisite 2).
   - Calls the matching service-layer function with `(supabase, userId,
     ...)`, using a service-role Supabase client.
   - Maps a thrown service-layer error to an MCP tool error result
     (`isError: true`) rather than letting it throw unhandled through the
     route.
   - Returns tool output as structured MCP content.

3. **Write clear, agent-facing tool and field descriptions.** These are
   what the calling AI agent reads to decide how to use the tool — avoid
   vague descriptions like "the id"; say what kind of id and where to get
   one (e.g. "the issue id, from list_issues or get_issue").

4. **Document the meaningful status transitions in the tool description
   for `update_issue_status`** — at minimum, make clear that transitioning
   from `draft` to `todo` specifically kicks off a background agent run,
   since a calling agent needs to understand that distinction among the
   full status enum, not just that the enum has many values.

## Out of scope

- Issue messages/chat tools (separate, unrelated task).
- Modifying `apps/web/app/api/v1/agent/**` or its Clerk API Key auth.

## Acceptance criteria

- From a connected MCP client: list projects, create an issue in one, list
  issues for that project, get it by id, update its title, transition it
  draft→todo and confirm (via the Gentic UI or Supabase) that `run_status`
  became `queued` and a kickoff message exists, then delete the issue.
- Attempting any of the above against another user's project/issue id
  (test with a second Clerk account / a second OAuth-authorized connection)
  returns a not-found-style tool error, never another user's data and never
  an unhandled exception.
- `pnpm --filter @gentic/web typecheck` and `lint` pass.
