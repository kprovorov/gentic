# T2 — Clerk OAuth + MCP transport scaffolding

## Depends on

Nothing. Can be done in parallel with T1. T3 depends on this.

## Why

We're exposing a remote MCP server that third-party AI agents (Claude,
ChatGPT, Cursor, etc.) connect to on a user's behalf. The user must
authenticate and explicitly authorize the connection — no static secret
copy-pasting. Clerk can act as the OAuth 2.1 authorization server for this
(separate feature from the Clerk **API Key** mechanism already used by
`apps/web/app/api/v1/agent/_lib.ts`, which is for the internal
`apps/gentic` worker and is not being changed). Clerk publishes an official
package (`@clerk/mcp-tools`) plus a Next.js guide built specifically for
this scenario, and it pairs with `mcp-handler` (Vercel's Next.js App Router
adapter for MCP's Streamable HTTP transport) — don't hand-roll either of
these from the raw `@modelcontextprotocol/sdk`.

This task builds the *scaffold only*: a working, authenticated MCP endpoint
that a client can discover, complete OAuth against, and connect to, exposing
zero or one trivial tool (e.g. a `ping`/`whoami` tool that returns the
authenticated Clerk user id). It proves the auth + transport wiring end to
end. Actual issue/project tools are T3/T4.

## Read first

- `apps/web/proxy.ts` — current `clerkMiddleware()` config (Next 16 renamed
  `middleware.ts` to `proxy.ts`), see what routes are already
  public/protected so you don't accidentally lock out or fail to protect the
  new `/api/mcp` and `/.well-known/*` routes.
- `apps/web/app/api/v1/agent/_lib.ts` — existing Clerk usage
  (`clerkClient()` from `@clerk/nextjs/server`) for style/import
  consistency. Do not modify this file.
- Clerk's official docs (fetch live, don't rely on training-data memory of
  exact API names since this is a fast-moving feature area):
  - https://clerk.com/docs/nextjs/guides/ai/mcp/build-mcp-server
  - https://clerk.com/docs/guides/ai/mcp/connect-mcp-client
  - https://github.com/clerk/mcp-tools (README has the package API surface)
- `mcp-handler` package docs/README for the Next.js App Router route handler
  shape it expects.

## Requirements

1. **Clerk Dashboard configuration (manual step — document it, don't try to
   script it):** register an OAuth Application for Gentic, enable **Dynamic
   Client Registration**. Write down the exact dashboard steps taken (as
   comments in this task's PR description or a short `docs/mcp-server/oauth-setup.md`
   note) since this can't be captured in code/version control. Flag any
   environment variables this produces (e.g. OAuth application client
   ID/secret if applicable) and add them to whatever `.env.example` file
   this repo uses for `apps/web` — check if one exists first.

2. **Add dependencies** to `apps/web/package.json`: `mcp-handler`,
   `@clerk/mcp-tools`, and `@modelcontextprotocol/sdk` (peer dep of the
   above, confirm exact version compatibility from their docs). Run
   `pnpm install` from the repo root (pnpm workspaces).

3. **Protected resource metadata endpoint**: a route (likely
   `apps/web/app/.well-known/oauth-protected-resource/route.ts`, confirm
   exact required path from the current MCP spec / Clerk's guide since this
   has changed between spec revisions) that returns
   `generateClerkProtectedResourceMetadata(...)` (or the current equivalent
   export from `@clerk/mcp-tools`) pointing at your resource URL.

4. **MCP route**: `apps/web/app/api/mcp/route.ts` using `mcp-handler`'s
   Next.js adapter for the Streamable HTTP transport, wired to verify the
   incoming Authorization header via `@clerk/mcp-tools`'s server-side
   verification helper. On success, expose a `whoami` tool (input: none,
   output: `{ userId: string }`) that returns the Clerk user id resolved
   from the token, so this task is independently testable without any
   issue/project logic existing yet.

5. **Error/challenge behavior**: unauthenticated or invalid-token requests
   must return the correct `401` + `WWW-Authenticate` header shape the MCP
   authorization spec expects (so compliant clients auto-trigger the OAuth
   flow rather than just failing). Confirm `@clerk/mcp-tools`'s helper does
   this for you rather than reimplementing it.

6. **Middleware**: check whether `apps/web/proxy.ts`'s `clerkMiddleware()`
   needs an explicit public-route exception for `/api/mcp` and
   `/.well-known/oauth-protected-resource` (OAuth-token-authenticated
   requests are not Clerk *session* requests, so the existing
   session-redirect behavior for protected routes must not intercept them).

## Out of scope

- No issue/project tools yet (T3/T4).
- No change to the existing `/api/v1/agent` API-key auth.
- No rate limiting (T5 flags this as a follow-up).

## Acceptance criteria

- Hitting `/.well-known/oauth-protected-resource` (unauthenticated) returns
  valid discovery metadata.
- Connecting a real MCP client that supports OAuth discovery (e.g. Claude
  Code's own `/mcp` connection flow, or `mcp-remote` against a local dev
  tunnel) completes the OAuth handshake against Clerk and successfully
  calls the `whoami` tool, returning the correct Clerk user id for whichever
  account authorized it.
- A request to `/api/mcp` with no token, or a garbage token, gets a `401`
  with a spec-compliant challenge — verified manually (e.g. `curl -i`) not
  just by absence of a crash.
- `pnpm --filter @gentic/web typecheck` and `lint` pass.
