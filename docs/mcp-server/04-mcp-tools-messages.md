# T4 — MCP tools: issue messages (chat)

## Depends on

T3 (reuses its tool-registration, auth-resolution, and error-mapping
conventions — read T3's finished code, not just its spec, before starting).

## Why

The Gentic UI lets a user converse with the background agent on an issue
(`apps/web/app/issues/[id]/issue-chat.tsx`, backed by `sendIssueMessage` in
`apps/web/app/issues/actions.ts`, moved to the service layer in T1). An MCP
client managing issues on a user's behalf should be able to do the same —
read the conversation on an issue and post a follow-up message — without
needing the Gentic web UI open.

## Read first

- `apps/web/lib/services/issues.ts` (from T1) — `sendIssueMessage`,
  including the re-queue-on-finished-run side effect; this must fire from
  the MCP tool exactly as it does from the UI.
- `apps/web/app/api/v1/agent/issues/[id]/messages/route.ts` and
  `apps/web/app/api/v1/agent/messages/[id]/route.ts` — the existing
  agent-facing message read/insert/update surface. Note the `role`
  (`user`/`assistant`/`system`) and `kind` (`text`/`tool`/`thinking`)
  fields on `messages` — an MCP client posting on a user's behalf should
  post as `role: "user"`, matching what `sendIssueMessage` already does; it
  should not be able to impersonate `assistant`/`system` messages (that's
  reserved for the internal `apps/gentic` worker via the API-key-authed
  agent routes, which are untouched by this task).
- `supabase/migrations/*.sql` for the exact `messages` table shape/enums —
  source of truth over any prose description.

## Requirements

1. **`list_issue_messages`** tool — input: `issue_id`; returns the
   conversation (role, kind, content, status, created_at) for an issue the
   caller owns. Add a `listIssueMessages(supabase, userId, issueId)`
   function to `apps/web/lib/services/issues.ts` (or a new
   `apps/web/lib/services/messages.ts` if that reads cleaner alongside a
   growing issues.ts) that enforces ownership via the same
   `projects!inner(user_id)` join pattern as the rest of T1, then returns
   messages for that issue ordered by `created_at`.

2. **`add_issue_message`** tool — input: `issue_id`, `content`; calls the
   T1 `sendIssueMessage` service function (already handles the
   re-queue-if-finished side effect) with `role: "user"`. Do not add a
   `role` input parameter to this tool — it should always post as the
   calling user, matching `sendIssueMessage`'s existing behavior.

3. Same conventions as T3 for auth resolution, ownership enforcement,
   zod-schema-driven input validation (add these schemas to
   `packages/validators/src/issues.ts` alongside the T1 schemas), and error
   mapping.

## Out of scope

- No changes to how the `apps/gentic` worker posts `assistant`/`system`
  messages via `/api/v1/agent/**`.
- No streaming/subscription support (MCP tools are request/response; if an
  agent wants live updates on a running issue, that's a future
  resources/subscriptions feature, not part of this task).

## Acceptance criteria

- From a connected MCP client: call `list_issue_messages` on an issue with
  existing conversation history and get back the same messages visible in
  the Gentic UI's chat for that issue.
- Call `add_issue_message` on a finished issue and confirm (via the UI or
  Supabase) that a new `role: "user"` message was inserted and
  `run_status` was reset to `queued`, matching what happens when a user
  types a follow-up in the web chat.
- Attempting either tool against an issue belonging to another user returns
  a not-found-style tool error.
- `pnpm --filter @gentic/web typecheck` and `lint` pass.
