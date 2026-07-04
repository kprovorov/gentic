# MCP server: Clerk OAuth setup

Gentic's remote MCP server (`apps/web/app/api/mcp/route.ts`) uses Clerk as its
OAuth 2.1 authorization server, via `@clerk/mcp-tools` + `mcp-handler`. This
requires one manual, per-Clerk-instance step in the Clerk Dashboard that
isn't captured by a code diff.

## Dashboard steps

For each Clerk instance (dev and production have separate settings):

1. Go to the [OAuth Applications](https://dashboard.clerk.com/~/oauth-applications)
   page in the Clerk Dashboard for the Gentic Clerk application.
2. Toggle on **Dynamic client registration**.

That's it — no static OAuth client needs to be created by hand. Dynamic
Client Registration ([RFC 7591](https://datatracker.ietf.org/doc/html/rfc7591))
lets each MCP client (Claude, ChatGPT, Cursor, `mcp-remote`, etc.) register
itself with Clerk the first time a user connects, instead of Gentic having
to pre-provision a client id/secret per third-party tool.

## Environment variables

No new environment variables are required beyond the Clerk keys Gentic
already uses (`NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY`, `CLERK_SECRET_KEY` in
`apps/web/.env.example`). `@clerk/mcp-tools`'s Next.js helpers derive
Clerk's authorization server URL from the publishable key automatically.

## What the code does

- `apps/web/app/.well-known/oauth-protected-resource/route.ts` — serves
  [RFC 9728](https://datatracker.ietf.org/doc/html/rfc9728) protected
  resource metadata (`protectedResourceHandlerClerk`), telling clients which
  authorization server (Clerk) issues tokens for this MCP resource. This is
  the single resource this deployment exposes, so it lives at the flat,
  default path rather than being namespaced per-endpoint.
- `apps/web/app/.well-known/oauth-authorization-server/route.ts` — serves
  [RFC 8414](https://datatracker.ietf.org/doc/html/rfc8414) authorization
  server metadata (`authServerMetadataHandlerClerk`) for MCP clients that
  still follow the older (2025-03-26) spec draft and expect this on the
  resource server's own origin.
- `apps/web/app/api/mcp/route.ts` — the MCP endpoint itself
  (Streamable HTTP transport via `mcp-handler`'s `createMcpHandler`), wrapped
  in `withMcpAuth` which verifies the bearer token via `@clerk/mcp-tools`'s
  `verifyClerkToken` and returns the spec-required `401` +
  `WWW-Authenticate` challenge for missing/invalid tokens.
- `apps/web/proxy.ts` — `/api/mcp` and `/.well-known/oauth-*` are not part
  of `isProtectedRoute`, so Clerk's session-cookie redirect logic (meant for
  browser page routes like `/home`) never intercepts these OAuth-bearer-token
  routes.

## Verifying it works

```bash
# Discovery metadata, unauthenticated
curl -i http://localhost:3000/.well-known/oauth-protected-resource

# No token -> 401 with a WWW-Authenticate challenge
curl -i http://localhost:3000/api/mcp

# Garbage token -> 401 with a WWW-Authenticate challenge
curl -i http://localhost:3000/api/mcp -H "Authorization: Bearer garbage"
```

To test the full OAuth handshake against a local dev server, tunnel it
(e.g. `ngrok http 3000`) and point an OAuth-capable MCP client (Claude Code,
or `npx mcp-remote https://<tunnel-host>/api/mcp`) at the tunnel URL. The
client should discover the protected resource metadata, complete Clerk's
hosted OAuth consent flow, and then be able to call the `whoami` tool.
