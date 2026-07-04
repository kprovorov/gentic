# MCP Server for Gentic — Implementation Plan

## Goal

Let external AI agents connect to Gentic over MCP (Model Context Protocol) and
manage issues (CRUD) on behalf of an authenticated Gentic user. The user
authenticates the connection themselves (OAuth), rather than pasting a static
API key.

## Chosen architecture (see task specs for detail)

- **Transport**: MCP Streamable HTTP, served from a new Next.js route in
  `apps/web`, using the `mcp-handler` package (Vercel's adapter for Next.js
  App Router).
- **Auth**: Clerk as the OAuth 2.1 authorization server (Clerk Dashboard →
  OAuth Applications, with Dynamic Client Registration enabled), verified on
  the resource-server side with `@clerk/mcp-tools`. This is a *separate* auth
  path from the existing Clerk **API Key** scheme in
  `apps/web/app/api/v1/agent/_lib.ts`, which stays as-is (it authenticates the
  internal `apps/gentic` worker, not third-party MCP clients).
- **Authorization inside tool handlers**: resolve the OAuth token to a Clerk
  user id, then use a service-role Supabase client with explicit ownership
  checks — the same pattern `_lib.ts` already uses for the agent API
  (`ensureIssueOwned`). Do **not** try to route MCP OAuth tokens through the
  session-based RLS path used by the web UI (`packages/supabase/src/server.ts`
  / `client.ts`); that path is specific to Clerk *session* JWTs via Supabase's
  third-party-auth integration, not MCP OAuth access tokens.
- **Business logic**: issue/project CRUD logic currently lives only in Next.js
  Server Actions (`apps/web/app/issues/actions.ts`,
  `apps/web/app/settings/actions.ts`). It gets extracted into a plain,
  client-agnostic service layer so Server Actions, the existing
  `/api/v1/agent` routes, and the new MCP tools all call the same rules
  instead of three copies drifting apart.

## Task graph

```
T1 (shared service layer)   T2 (Clerk OAuth + MCP scaffold)
        \                        /
         \                      /
          v                    v
        T3 (MCP tools: projects & issues)
                    |
                    v
        T4 (MCP tools: issue messages/chat)
                    |
                    v
        T5 (tests, hardening, docs)
```

T1 and T2 have no dependency on each other and can be worked in parallel (by
the same or different agents/sessions). T3 depends on both. T4 depends on T3
(reuses its tool-registration and error-handling conventions). T5 depends on
T3 and T4 existing.

## Files in this plan

- `01-shared-issue-service.md`
- `02-clerk-oauth-mcp-scaffold.md`
- `03-mcp-tools-projects-issues.md`
- `04-mcp-tools-messages.md`
- `05-tests-hardening-docs.md`

Each file is self-contained enough to hand to a separate agent/session: it
states the goal, what to read first, concrete requirements, what's out of
scope, and acceptance criteria. Where an exact detail in the current
codebase matters (enum values, table columns) the spec points at the
source-of-truth file rather than restating it, since restating risks going
stale or being misremembered.

## Non-goals for this round

- No organizations/teams/multi-tenancy — Gentic is single-tenant per Clerk
  user today; don't add scoping infrastructure for a feature that doesn't
  exist yet.
- No per-key/per-client scoped permissions (e.g. read-only tokens) — every
  authenticated MCP session gets the same access a logged-in user has to
  their own data. Can be layered on later via OAuth scopes if needed.
- No rate limiting in this round — flagged as a follow-up in T5, not blocking.
