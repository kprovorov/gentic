# Extract a shared issue & project service layer

## Context

Gentic is a pnpm/Turborepo monorepo. `apps/web` is a Next.js (App Router)
app using Clerk for auth and Supabase (via `@gentic/supabase`) for data,
with Postgres RLS scoping every query to the logged-in Clerk user. It
manages "issues" (dev tasks executed by a background coding agent) grouped
under "projects" (each project wraps a git repo). We're about to add new
ways for callers other than the logged-in browser session — a REST-style
API and, separately, an MCP (Model Context Protocol) server for AI agents —
to perform the same issue/project CRUD operations a logged-in user can do
today. Those callers won't have a Clerk browser session; they'll resolve to
a Clerk user id some other way (API key, OAuth token) and use a
service-role Supabase client that bypasses RLS entirely.

Today, all issue/project CRUD logic lives only inside Next.js Server
Actions, and its only authorization is implicit: the RLS-scoped Supabase
client silently limits rows to the logged-in user. That's fine for the
browser, but it means the business rules (validation, and non-trivial status
side effects — see below) aren't reusable by a non-session caller, and
authorization isn't enforced by the logic itself. This task extracts that
logic into a plain, framework-agnostic service layer that takes a Supabase
client and a Clerk user id explicitly, and enforces ownership itself
(regardless of whether the client passed in even has RLS active), so any
future caller — browser session or not — gets identical behavior and
identical authorization guarantees.

## Read first

- `apps/web/app/issues/actions.ts` — current issue CRUD
  (`createIssue`, `updateIssue`, `deleteIssue`, `updateIssueStatus`,
  `sendIssueMessage`). Read the comments in `updateIssueStatus` and
  `sendIssueMessage` carefully: moving an issue from `draft` to `todo` sets
  `run_status: "queued"` and inserts a kickoff message (title + prompt) —
  this is what causes the separate `apps/gentic` background worker to pick
  the issue up and start a Claude Code run against the project's repo.
  Sending a message on an issue whose `run_status` is
  `completed`/`failed`/`cancelled` re-queues it so the worker resumes. Both
  side effects are load-bearing product behavior, not incidental — they
  must be preserved exactly by the extracted service functions.
- `apps/web/app/settings/actions.ts` — current project CRUD
  (`createProject`, `updateProject`, `deleteProject`).
- `apps/web/app/api/v1/agent/_lib.ts` — an existing non-session caller for
  reference/style only (it's the internal worker's API, authenticated via a
  Clerk API key, not something this task modifies). Look specifically at
  `ensureIssueOwned`: since the `issues` table has no `user_id` column of
  its own, ownership is checked via a join to `projects` —
  `.select("id, projects!inner(user_id)").eq("projects.user_id", userId)`.
  Reuse this exact join pattern in the new service layer rather than
  inventing a different one.
- `packages/supabase/src/service.ts`, `server.ts`, `client.ts` — the three
  Supabase client factories in play (service-role/bypasses-RLS,
  session-scoped server client, browser client).
- `packages/validators/src/auth.ts` and `packages/validators/package.json`
  — the existing pattern for this validators package: one file per domain,
  zod schemas plus `z.infer` exported types, added to `package.json`'s
  `exports` map as a subpath (currently only `"./auth": "./src/auth.ts"`).
  Follow this exact pattern for the new schemas.
- `supabase/migrations/*.sql` — source of truth for the `projects`,
  `issues`, `messages` table shapes and check constraints (including the
  full issue status enum). Don't guess column names or enum values from
  anything other than these files and `actions.ts`.

## Requirements

1. **Move validation schemas into `@gentic/validators`.**
   - New file `packages/validators/src/issues.ts` exporting: the issue
     status enum currently inlined in `apps/web/app/issues/actions.ts` as
     `issueStatusSchema`, plus `createIssueSchema`, `updateIssueSchema`,
     `updateIssueStatusSchema`, `sendIssueMessageSchema` — same field
     constraints as currently inlined in `actions.ts`.
   - New file `packages/validators/src/projects.ts` exporting a
     `projectSchema` (the create/update schema currently duplicated in
     `settings/actions.ts` — keep it unified as one schema unless you find
     a real divergence between create and update needs) and an `idSchema`
     for uuid route/tool params.
   - Add `"./issues"` and `"./projects"` entries to
     `packages/validators/package.json`'s `exports`, mirroring `"./auth"`.
   - Export TS types (`z.infer<...>`) alongside each schema, matching the
     `LoginValues`-style naming already used in `auth.ts`.

2. **Create a service layer in `apps/web/lib/services/`** (new directory —
   plain TypeScript, no `"use server"`, no `next/navigation` or
   `next/cache` imports, so it's callable from Server Actions, Route
   Handlers, or any other server-side entry point):
   - `apps/web/lib/services/errors.ts`: a small typed error, e.g.
     `class ServiceError extends Error { code: "not_found" | "forbidden" |
     "validation"; ... }`. Every service function throws this (never a bare
     `Error`) so callers can map it to whatever error shape they need
     (thrown error for a Server Action, an HTTP status for a REST route, a
     tool error for an MCP tool).
   - `apps/web/lib/services/projects.ts`: `listProjects(supabase, userId)`,
     `getProject(supabase, userId, id)`, `createProject(supabase, userId,
     input)`, `updateProject(supabase, userId, id, input)`,
     `deleteProject(supabase, userId, id)`. Every function filters by
     `user_id = userId` explicitly in the query — do not rely on the caller
     having already scoped the client via RLS.
   - `apps/web/lib/services/issues.ts`: `listIssues(supabase, userId,
     filters?: { projectId?: string })`, `getIssue(supabase, userId, id)`,
     `createIssue(supabase, userId, input)`, `updateIssue(supabase, userId,
     id, input)`, `deleteIssue(supabase, userId, id)`,
     `updateIssueStatus(supabase, userId, id, status)` (preserve the
     `draft -> todo` run-queueing side effect and kickoff message insert,
     verbatim), `sendIssueMessage(supabase, userId, issueId, content)`
     (preserve the re-queue-on-follow-up side effect, verbatim). Enforce
     ownership via the `projects!inner(user_id)` join pattern noted above.
   - Every function throws `ServiceError` with `code: "not_found"` when a
     row doesn't exist or isn't owned by `userId` — don't leak the
     existence of another user's row via a different error or status.

3. **Rewire the existing Server Actions to call the service layer** instead
   of inlining Supabase calls:
   - `apps/web/app/issues/actions.ts` functions become thin: parse
     `FormData` → validate with the matching `@gentic/validators/issues`
     schema → call the matching `apps/web/lib/services/issues.ts` function
     → keep the existing `revalidatePath`/`redirect` calls (those are
     Next.js-specific and stay in the Server Action, not the service).
   - Same for `apps/web/app/settings/actions.ts` against
     `apps/web/lib/services/projects.ts`.
   - This is a pure refactor, not a behavior change — no changes to
     `app/issues/**` or `app/settings/**` page/component files should be
     needed, and the UI must behave identically before and after.

4. **Do not touch `apps/web/app/api/v1/agent/**`.** It's an existing,
   separately-authenticated API for the internal background worker;
   nothing in this task requires changing it, and migrating it onto the
   new service layer (optional future cleanup) is out of scope here.

## Out of scope

- No new API routes, no auth changes, no MCP-related code of any kind.
- No change to the `messages` table's `role`/`kind`/`status` enums or any
  schema already defined in `apps/web/app/api/v1/agent/_lib.ts`.
- No database migrations.

## Acceptance criteria

- `apps/web/app/issues/actions.ts` and `apps/web/app/settings/actions.ts`
  contain no direct `.from("issues")` / `.from("projects")` /
  `.from("messages")` Supabase calls — all of that lives in
  `apps/web/lib/services/*`.
- `pnpm --filter @gentic/web typecheck` and
  `pnpm --filter @gentic/validators typecheck` pass.
- `pnpm --filter @gentic/web lint` passes.
- Manually exercised: create, edit, delete an issue; change status from
  Draft to Todo and confirm a message is seeded and `run_status` becomes
  `queued`; send a follow-up message on a finished issue and confirm it's
  re-queued. All existing UI behavior in `apps/web/app/issues/**` and
  `apps/web/app/settings/**` is unchanged.
