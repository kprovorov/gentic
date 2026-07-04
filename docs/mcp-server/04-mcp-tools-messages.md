# Build MCP tools for issue messages (chat)

## Context

Gentic is a pnpm/Turborepo monorepo. `apps/web` is a Next.js (App Router)
app managing "issues" (dev tasks executed by a background coding agent)
grouped under "projects", using Clerk for auth and Supabase for data. Each
issue has an associated conversation (`messages` table: `role`
`user`/`assistant`/`system`, `kind` `text`/`tool`/`thinking`, `content`,
`status` `streaming`/`complete`/`error`) that the Gentic web UI renders as a
chat, letting a user send follow-up instructions to the background agent
working the issue. Gentic exposes an MCP (Model Context Protocol) server so
third-party AI agents can connect on a user's behalf (via Clerk OAuth) and
manage that user's issues. This task adds message/chat tools to that MCP
server so a connected agent can read and continue an issue's conversation
the same way the web UI does.

## Prerequisites — verify these exist in the codebase before starting

1. **An authenticated MCP endpoint** at `apps/web/app/api/mcp/route.ts`
   (built with `mcp-handler` + Clerk OAuth verification via
   `@clerk/mcp-tools`) that already registers at least the issue CRUD tools
   (`list_issues`, `get_issue`, `create_issue`, `update_issue`,
   `delete_issue`, `update_issue_status`). There should be a small, reusable
   helper that resolves a verified request to a Clerk `userId` — reuse it
   for the tools you add here; don't reimplement token verification. Follow
   the same tool-registration and error-mapping conventions those existing
   tools use (an MCP tool error result with `isError: true` on failure, not
   an unhandled throw) so the whole tool set is consistent.

2. **A plain, framework-agnostic service layer** at
   `apps/web/lib/services/issues.ts` (or a neighboring
   `apps/web/lib/services/messages.ts`) exposing a `sendIssueMessage(supabase,
   userId, issueId, content)` function that: inserts a `role: "user"`
   message on the issue, and — if the issue's current `run_status` is
   `completed`, `failed`, or `cancelled` — resets it to `queued` so the
   background worker resumes on the follow-up. This mirrors exactly what
   happens when a user sends a message from the Gentic web chat
   (`apps/web/app/issues/[id]/issue-chat.tsx`, via a Server Action). If this
   function doesn't exist yet, build it following the ownership-enforcement
   pattern used by the rest of that service layer (join through `projects`
   to check `user_id`, since `issues`/`messages` have no `user_id` column of
   their own — get exact table/column names from `supabase/migrations/*.sql`).

## Read first

- Whatever files satisfy the two prerequisites above.
- `apps/web/app/api/v1/agent/issues/[id]/messages/route.ts` and
  `apps/web/app/api/v1/agent/messages/[id]/route.ts` — the existing
  agent-facing message read/insert/update surface (reference only, don't
  modify — this is the internal worker's separately-authenticated API).
  Note that it can insert `assistant`/`system` messages; the tools you're
  building here must not expose that ability — an MCP client acting on a
  user's behalf should only ever post as `role: "user"`, matching what the
  web UI's send-message action does.
- `supabase/migrations/*.sql` for the exact `messages` table shape/enums —
  treat this as the source of truth over any prose description.

## Requirements

1. **`list_issue_messages`** tool — input: `issue_id`; returns the
   conversation (role, kind, content, status, created_at) for an issue the
   caller owns, ordered by `created_at`. If a corresponding service
   function doesn't already exist, add one that enforces ownership via the
   `projects` join (same pattern as the rest of the service layer) before
   returning rows.

2. **`add_issue_message`** tool — input: `issue_id`, `content`; calls the
   service layer's `sendIssueMessage` function (which already handles the
   re-queue-if-finished side effect) with `role: "user"`. Do not expose a
   `role` input on this tool — it must always post as the calling user.

3. Follow the same auth-resolution, ownership-enforcement,
   zod-schema-driven input validation, and error-mapping conventions as the
   rest of the MCP server's tools (see prerequisite 1). Add any new zod
   schemas to the validators package used elsewhere in this project for
   issue-related input (check for an existing `packages/validators/src/issues.ts`
   or similar before creating a new location).

## Out of scope

- Changing how the internal background worker posts `assistant`/`system`
  messages via `apps/web/app/api/v1/agent/**`.
- Streaming/subscription support — MCP tools here are plain request/
  response; live-updating an in-progress run is a different kind of feature
  and not part of this task.

## Acceptance criteria

- From a connected MCP client: call `list_issue_messages` on an issue with
  existing conversation history and get back the same messages visible in
  the Gentic UI's chat for that issue.
- Call `add_issue_message` on a finished issue and confirm (via the UI or
  Supabase) that a new `role: "user"` message was inserted and
  `run_status` was reset to `queued`, matching what happens when a user
  types a follow-up in the web chat.
- Attempting either tool against an issue belonging to another user (test
  with a second Clerk account / OAuth-authorized connection) returns a
  not-found-style tool error.
- `pnpm --filter @gentic/web typecheck` and `lint` pass.
