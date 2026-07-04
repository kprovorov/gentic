# T5 — Tests, hardening, and docs

## Depends on

T3 and T4 (needs the finished tool set to test against).

## Why

Nothing in this repo has automated tests today (no `vitest.config.*`,
`jest.config.*`, or `*.test.ts`/`*.spec.ts` files exist anywhere in the
monorepo as of this plan being written — confirm this is still true before
assuming any test infra exists). The service layer from T1 is exactly the
kind of pure, client-agnostic logic that's cheap to unit test and easy to
regress silently (especially the run-queueing side effects), so this is a
reasonable place to introduce testing rather than shipping the whole MCP
feature with zero coverage. This task also covers the operational loose
ends flagged as non-goals in the other specs.

## Read first

- `packages/*/package.json` across the monorepo for the existing
  `lint`/`typecheck` script conventions (`turbo.json`, root `package.json`)
  — a new `test` script should follow the same per-package + turbo-pipeline
  pattern, not a bolted-on one-off.
- Everything built in T1–T4.

## Requirements

1. **Introduce a test runner.** Vitest is the natural default for this
   stack (Vite-free but well-supported for plain TS + Next.js server code,
   fast, no extra config ceremony compared to Jest in an ESM monorepo like
   this one — confirm this reasoning still holds rather than taking it on
   faith). Add it as a shared dev dependency, wire a `test` script into
   `turbo.json`'s pipeline, and add per-package `test` scripts starting
   with `apps/web` and `packages/validators`.

2. **Unit tests for the T1 service layer**
   (`apps/web/lib/services/issues.ts`, `projects.ts`) covering, at minimum:
   - Ownership enforcement: a service-role-client call for a resource
     belonging to a different `userId` throws `ServiceError` with
     `code: "not_found"`, never returns the row.
   - The `draft -> todo` status transition: confirm it sets
     `run_status: "queued"` and inserts exactly one kickoff message with
     the expected content (title, or title+prompt).
   - Any other `updateIssueStatus` transition does *not* touch
     `run_status` or insert a message.
   - `sendIssueMessage` re-queues only when the issue's current
     `run_status` is `completed`/`failed`/`cancelled`, and leaves it alone
     otherwise (e.g. while `running`).
   - Use a fake/mocked Supabase client (or a local Supabase test instance if
     the repo's `supabase/` setup already supports one — check
     `supabase/config.toml` / README for a documented local dev DB before
     building a mock from scratch) rather than hitting the real project's
     database.

3. **Integration test (or a documented manual test script if an in-process
   MCP client harness proves impractical) for the MCP tools** from T3/T4:
   drive the actual `/api/mcp` route with a real or stubbed authenticated
   request per tool, asserting on tool output shape and cross-user
   isolation.

4. **Docs**: a short `docs/mcp-server/connecting.md` (user-facing, not
   agent-facing) explaining how a Gentic user connects an MCP client
   (Claude, Cursor, etc.) to their account — what URL to point the client
   at, what to expect during the OAuth consent step, and how to revoke
   access afterward (check what revocation surface Clerk's OAuth
   Applications dashboard actually exposes, e.g. can the *user* revoke a
   connected app themselves, or only an admin — this materially affects
   what the doc can promise).

5. **Flag, don't necessarily build, these follow-ups** (call them out
   explicitly in the PR description so they're not silently forgotten,
   rather than scope-creeping them into this task):
   - Rate limiting on `/api/mcp` — there's none anywhere in the app today
     and a public MCP endpoint is a more attractive abuse target than the
     existing UI.
   - Whether `apps/web/app/api/v1/agent/**` should be migrated onto the T1
     service layer for consistency (optional cleanup noted in T3, not
     required).
   - Scoped/read-only OAuth tokens, if Clerk's OAuth Applications support
     custom scopes — not needed for a first version where every
     authenticated session gets full CRUD, but worth knowing whether it's
     available before a user asks for a "read-only agent" use case.

## Out of scope

- No new product features — this task is test coverage, docs, and an
  explicit written record of what's deliberately deferred.

## Acceptance criteria

- `pnpm test` (or the equivalent turbo-piped command) runs and passes
  across the touched packages in CI-equivalent conditions locally.
- The service-layer behaviors listed above are each covered by at least one
  test that fails if the behavior is broken (verify this by briefly
  breaking each one and confirming the test catches it, then revert).
- `docs/mcp-server/connecting.md` exists and accurately reflects the actual
  OAuth consent/revocation UX as built, not an assumed/idealized version of
  it.
