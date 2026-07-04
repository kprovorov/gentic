# Set up Clerk OAuth and the MCP transport scaffold

## Context

Gentic is a pnpm/Turborepo monorepo. `apps/web` is a Next.js (App Router,
Next 16) app that already uses Clerk (`@clerk/nextjs`) for user auth and
Supabase for data. We're building a remote MCP (Model Context Protocol)
server so third-party AI agents (Claude, ChatGPT, Cursor, etc.) can connect
to Gentic on a user's behalf and manage that user's data. The user must
explicitly authenticate and authorize the connection themselves — no
static secret copy-pasted into a config file. Clerk can act as the OAuth
2.1 authorization server for this: it has a dedicated feature ("OAuth
Applications" in the Clerk Dashboard, with a Dynamic Client Registration
toggle) plus an official package, `@clerk/mcp-tools`, and an official
Next.js guide built specifically for wiring Clerk OAuth into an MCP server.
That package is designed to pair with `mcp-handler` (Vercel's Next.js App
Router adapter for MCP's Streamable HTTP transport) — use these rather than
hand-rolling OAuth or the transport layer from the raw
`@modelcontextprotocol/sdk`.

Note: Gentic separately has a Clerk **API Key** auth mechanism (bearer
tokens verified via `clerkClient().apiKeys.verify(...)`) used by an internal
background worker to call `apps/web/app/api/v1/agent/**`. That is a
different, already-working mechanism for a different, trusted, internal
caller — do not modify it, do not reuse it for this task, and do not confuse
it with the OAuth flow you're building here for third-party MCP clients.

This task builds the *scaffold only*: a working, OAuth-authenticated MCP
endpoint that a client can discover, complete the OAuth flow against, and
connect to, exposing a single trivial tool (e.g. `whoami`, returning the
authenticated Clerk user id) to prove the wiring works end to end. It does
not implement any product functionality (no issue/project tools) — that is
separate follow-on work this task doesn't need to know about.

## Read first

- `apps/web/proxy.ts` — current `clerkMiddleware()` config (Next 16 renamed
  `middleware.ts` to `proxy.ts`). Check which routes are public vs.
  session-protected today so you can add the right exceptions for the new
  `/api/mcp` and OAuth-discovery routes — requests to those routes are
  authenticated via an OAuth bearer token, not a Clerk session cookie, and
  must not be redirected to a login page by the existing middleware.
- `apps/web/app/api/v1/agent/_lib.ts` — for `@clerk/nextjs/server` import
  style/conventions only (e.g. `clerkClient()` usage). Do not modify this
  file or anything under `apps/web/app/api/v1/agent/`.
- `apps/web/package.json` — current dependency versions (Next 16, React
  19, Clerk `^7.5.12`, zod `^4`) so any new dependency you add is
  version-compatible.
- Fetch Clerk's current docs live rather than relying on memory, since this
  is a fast-moving feature area and exact API/package names may have
  changed:
  - https://clerk.com/docs/nextjs/guides/ai/mcp/build-mcp-server
  - https://clerk.com/docs/guides/ai/mcp/connect-mcp-client
  - https://github.com/clerk/mcp-tools (README documents the package's
    exported helpers)
- Fetch the `mcp-handler` package's README/docs for the exact Next.js App
  Router route handler shape it expects.

## Requirements

1. **Clerk Dashboard configuration (manual step — document it, don't try to
   script it):** register an OAuth Application for Gentic in the Clerk
   Dashboard and enable **Dynamic Client Registration** (required so MCP
   clients can self-register during the OAuth handshake without manual
   per-client provisioning). Write down the exact dashboard steps taken —
   add a short `docs/mcp-server/oauth-setup.md` note describing them — since
   dashboard configuration isn't captured by a code diff. Note any resulting
   environment variables and add them to whatever `.env.example` file this
   repo uses for `apps/web` (check whether one already exists before adding
   a new one).

2. **Add dependencies** to `apps/web/package.json`: `mcp-handler`,
   `@clerk/mcp-tools`, and `@modelcontextprotocol/sdk` (a peer dependency of
   the above — confirm exact compatible versions from their docs/READMEs).
   Run `pnpm install` from the repo root (this is a pnpm workspace).

3. **Protected resource metadata endpoint**: a route (confirm the exact
   required path from the current MCP authorization spec and Clerk's guide,
   since this has moved between spec revisions — it is commonly
   `apps/web/app/.well-known/oauth-protected-resource/route.ts`) that
   returns the metadata object produced by `@clerk/mcp-tools`'s
   resource-metadata helper, pointing at your MCP resource URL.

4. **MCP route**: `apps/web/app/api/mcp/route.ts` using `mcp-handler`'s
   Next.js adapter for the Streamable HTTP transport, wired to verify the
   incoming `Authorization` header via `@clerk/mcp-tools`'s server-side
   token verification helper. On success, register one tool, `whoami`
   (no input; output `{ userId: string }`), returning the Clerk user id
   resolved from the verified token. This is the only tool this task needs
   to ship — it exists purely to prove the auth + transport wiring, and its
   handler's "resolve the token to a Clerk userId" logic should be written
   as a small, separately-callable helper (not buried inline in the route),
   since it's the piece every future tool will need to reuse.

5. **Error/challenge behavior**: unauthenticated or invalid-token requests
   to `/api/mcp` must return the `401` + `WWW-Authenticate` header shape
   the MCP authorization spec requires, so compliant clients automatically
   trigger the OAuth flow instead of just failing silently. Confirm
   `@clerk/mcp-tools`'s helper produces this correctly rather than
   reimplementing the header format yourself.

6. **Middleware**: update `apps/web/proxy.ts`'s `clerkMiddleware()`
   configuration if needed so `/api/mcp` and the `.well-known` route are
   not intercepted by the existing session-redirect behavior meant for
   browser page routes.

## Out of scope

- No issue/project/message tools — a single `whoami` tool is sufficient
  for this task.
- No changes to `apps/web/app/api/v1/agent/**` or its Clerk API Key auth.
- No rate limiting.

## Acceptance criteria

- Hitting `/.well-known/oauth-protected-resource` unauthenticated returns
  valid discovery metadata (verify against the MCP spec's expected shape).
- Connecting a real MCP client that supports OAuth discovery (e.g. Claude
  Code's own MCP connection flow, or `mcp-remote` against a local dev
  tunnel) completes the OAuth handshake against Clerk and successfully
  calls the `whoami` tool, returning the correct Clerk user id for whichever
  Gentic account authorized the connection.
- A request to `/api/mcp` with no token, or a garbage token, gets a `401`
  with a spec-compliant challenge header — verified manually (e.g. with
  `curl -i`), not just by absence of a crash.
- `pnpm --filter @gentic/web typecheck` and `lint` pass.
