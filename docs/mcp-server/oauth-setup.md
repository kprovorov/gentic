# MCP server: Clerk OAuth setup

Gentic's remote MCP server now lives in the separate Express app at
`apps/mcp`. Deploy it as its own service and point `mcp.gentic.chat` at that
deployment.

The app uses Clerk as its OAuth 2.1 authorization server via
`@clerk/mcp-tools/express`, and serves the MCP protocol through
`mcp-handler`.

## Dashboard steps

For each Clerk instance (dev and production have separate settings):

1. Go to the [OAuth Applications](https://dashboard.clerk.com/~/oauth-applications)
   page in the Clerk Dashboard for the Gentic Clerk application.
2. Toggle on **Dynamic client registration**.

No static OAuth client needs to be created by hand. Dynamic Client
Registration lets each MCP client (Claude, ChatGPT, Cursor, `mcp-remote`,
etc.) register itself with Clerk the first time a user connects.

## Environment variables

Set these on the `apps/mcp` deployment:

```bash
CLERK_PUBLISHABLE_KEY=
CLERK_SECRET_KEY=
SUPABASE_URL=
SUPABASE_SERVICE_ROLE_KEY=
```

For local development, copy `apps/mcp/.env.example` to `apps/mcp/.env` and
fill in the same values.

## Endpoints

- `GET /health` returns a basic health check.
- `POST /mcp` is the canonical Streamable HTTP MCP endpoint.
- `POST /` is also accepted so `https://mcp.gentic.chat` can be used directly
  by clients that allow root MCP URLs.
- `POST /api/mcp` is accepted as a migration path from the old web-app route.
- `GET /.well-known/oauth-protected-resource[/...]` serves RFC 9728 protected
  resource metadata for OAuth-capable MCP clients.
- `GET /.well-known/oauth-authorization-server` serves Clerk authorization
  server metadata for older clients that expect it on the resource origin.

## Local verification

```bash
pnpm --filter @gentic/mcp dev

# Discovery metadata, unauthenticated
curl -i http://localhost:3001/.well-known/oauth-protected-resource/mcp

# No token -> 401 with a WWW-Authenticate challenge
curl -i http://localhost:3001/mcp

# Garbage token -> 401
curl -i http://localhost:3001/mcp -H "Authorization: Bearer garbage"
```

To test the full OAuth handshake against a local dev server, tunnel it
(for example, `ngrok http 3001`) and point an OAuth-capable MCP client at
`https://<tunnel-host>/mcp`. The client should discover the protected resource
metadata, complete Clerk's hosted OAuth consent flow, and then be able to call
the `whoami` tool.
