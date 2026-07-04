# T1 — Extract a shared issue/project service layer

## Depends on

Nothing. Can be done in parallel with T2.

## Why

Issue and project CRUD logic currently exists only as Next.js Server Actions,
authorized implicitly by Supabase RLS (the session-bound client from
`@gentic/supabase/server` scopes every query to the logged-in Clerk user via
`auth.jwt()->>'sub'`). Two other callers need the same business rules without
a Clerk session:

- `apps/web/app/api/v1/agent/*` (already exists, used by the `apps/gentic`
  worker, authenticates via Clerk API Key)
- The new MCP tools being built in T3/T4 (authenticate via Clerk OAuth token)

Both of those use a **service-role** Supabase client
(`@gentic/supabase/service`), which bypasses RLS entirely. Today `_lib.ts`
hand-rolls ownership checks (`ensureIssueOwned`, `ensureMessageOwned`) only
for the endpoints that exist so far (claim/run-state/messages) — there is no
equivalent for create/update/delete/list, because nothing needed them until
now. Rather than hand-roll ownership checks again for MCP, and rather than
have create/update/delete/status-transition rules live only inside
`"use server"` functions that assume a request-scoped Clerk session, this
task pulls the actual logic into plain functions that take `(supabase,
userId, ...)` explicitly and enforce ownership themselves — so authorization
does not depend on which kind of Supabase client the caller happens to pass
in. RLS remains active as defense-in-depth for the session-client path; it
is no longer the *only* thing enforcing ownership.

## Read first

- `apps/web/app/issues/actions.ts` — current issue CRUD + status-transition
  side effects (queuing a run, seeding the kickoff message, re-queuing on
  follow-up message). Read the comments in `updateIssueStatus` and
  `sendIssueMessage` carefully — the run-queueing behavior is load-bearing
  and must be preserved exactly.
- `apps/web/app/settings/actions.ts` — current project CRUD.
- `apps/web/app/api/v1/agent/_lib.ts` — existing ownership-check pattern
  (`ensureIssueOwned`, `ensureMessageOwned`), `ApiError`, and the zod schemas
  already living there (`runStateSchema`, `insertMessageSchema`,
  `updateMessageSchema`) — these stay where they are, this task does not
  touch the agent routes.
- `packages/supabase/src/service.ts`, `server.ts`, `client.ts` — the three
  Supabase client factories in play.
- `packages/validators/src/auth.ts` and `packages/validators/package.json` —
  the existing pattern for a validators subpackage (`"./auth":
  "./src/auth.ts"` export map). Follow this exact pattern for the new
  schemas.
- `supabase/migrations/*.sql` — source of truth for the `projects`,
  `issues`, `messages` table shapes and check constraints. Don't guess at
  column names or the status enum from anything other than these files and
  `actions.ts`.

## Requirements

1. **Move validation schemas into `@gentic/validators`.**
   - New file `packages/validators/src/issues.ts` exporting: the issue
     status enum (`issueStatusSchema`), `createIssueSchema`,
     `updateIssueSchema`, `updateIssueStatusSchema`, `sendIssueMessageSchema`
     — same field constraints as currently inlined in
     `apps/web/app/issues/actions.ts`.
   - New file `packages/validators/src/projects.ts` exporting
     `projectSchema` (create + update — check whether they should really be
     one schema or two; currently `createProject`/`updateProject` in
     `settings/actions.ts` use an identical `projectSchema`, keep them
     unified unless a real divergence appears) and an `idSchema` for uuid
     params.
   - Add `"./issues"` and `"./projects"` entries to
     `packages/validators/package.json` `exports`, mirroring `"./auth"`.
   - Export TS types (`z.infer<...>`) alongside each schema, matching the
     `LoginValues`-style naming already used in `auth.ts`.

2. **Create a service layer in `apps/web/lib/services/`** (new directory —
   plain TypeScript, no `"use server"`, no `next/navigation` or
   `next/cache` imports, so it's callable from Server Actions, Route
   Handlers, and MCP tool handlers alike):
   - `apps/web/lib/services/errors.ts`: a small typed error, e.g.
     `class ServiceError extends Error { code: "not_found" | "forbidden" |
     "validation"; ... }`, used instead of `_lib.ts`'s `ApiError` (which is
     HTTP-status-shaped and stays local to the agent routes — each caller
     maps `ServiceError` to whatever error shape it needs: `ApiError` for
     the agent routes if you choose to migrate them, MCP tool errors for
     MCP, thrown `Error` for Server Actions).
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
     `updateIssueStatus(supabase, userId, id, status)` (must preserve the
     `draft -> todo` run-queueing side effect and kickoff message insert,
     verbatim), `sendIssueMessage(supabase, userId, issueId, content)` (must
     preserve the re-queue-on-follow-up side effect, verbatim). Since
     `issues` has no `user_id` column, ownership is via the `projects`
     join — follow the `ensureIssueOwned` join pattern (`.select("id,
     projects!inner(user_id)").eq("projects.user_id", userId)`) rather than
     inventing a new one.
   - Every function throws `ServiceError` with `code: "not_found"` when a
     row doesn't exist or isn't owned by `userId` (don't leak existence of
     other users' rows via a different error).

3. **Rewire the existing Server Actions to call the service layer** instead
   of inlining Supabase calls:
   - `apps/web/app/issues/actions.ts` functions become thin: parse
     `FormData` → call the matching `@gentic/validators/issues` schema →
     call the matching `apps/web/lib/services/issues.ts` function → keep the
     existing `revalidatePath`/`redirect` calls (those are Next.js-specific
     and stay in the Server Action, not the service).
   - Same for `apps/web/app/settings/actions.ts` against
     `apps/web/lib/services/projects.ts`.
   - Behavior must be identical from the UI's perspective — this is a pure
     refactor, not a behavior change. No changes to `app/issues/**` or
     `app/settings/**` page/component files should be needed.

4. **Do not touch `apps/web/app/api/v1/agent/**` in this task.** T3 will
   decide whether those routes should also be migrated onto the new service
   layer; keep this task's diff scoped to the refactor + Server Actions.

## Out of scope

- No new API routes, no MCP code, no auth changes.
- No change to the `messages` table's `role`/`kind`/`status` enums or the
  agent-side message schemas in `_lib.ts`.
- No database migrations.

## Acceptance criteria

- `apps/web/app/issues/actions.ts` and `apps/web/app/settings/actions.ts`
  contain no direct `.from("issues")` / `.from("projects")` /
  `.from("messages")` Supabase calls — all of that lives in
  `apps/web/lib/services/*`.
- `pnpm --filter @gentic/web typecheck` and
  `pnpm --filter @gentic/validators typecheck` pass.
- `pnpm --filter @gentic/web lint` passes.
- Manually exercised (or covered by tests if T5 has landed first): create,
  edit, delete an issue; change status from Draft to Todo and confirm a
  message is seeded and `run_status` becomes `queued`; send a follow-up
  message on a finished issue and confirm it's re-queued. All existing UI
  behavior in `apps/web/app/issues/**` and `apps/web/app/settings/**` is
  unchanged.
