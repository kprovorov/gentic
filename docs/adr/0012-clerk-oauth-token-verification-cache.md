# 12. Clerk OAuth token verification is cached in the MCP route

Date: 2026-09-09

## Status

Accepted

## Context

Clerk meters machine authentication. The free allowance is 100,000 token
verifications a month; past that they are billed per verification. GEN-444
reports the account crossing that line, and reasonably suspected the host's
polling loop: a host asks the agent API for work every three seconds, which is
~28 requests a minute even while idle.

That suspicion is out of date but was well earned. Before hosts replaced
connected workers (ADR 11) the agent API authenticated with a shared Clerk API
key and verified it against Clerk on every request, with an Upstash Redis cache
in front to keep the host's polling from re-billing each time. The host
credential migration deleted that path — `authenticateHostCredential` now
resolves a `gtwc_...` credential against `hosts.credential_hash` in Supabase and
never calls Clerk — but it also deleted the cache's only caller. What survived
was `lib/redis.ts` with no callers and an `.env.example` comment still promising
"shared cache for agent API-key verification". Read from the outside, the system
looked exactly like a cache that had stopped working.

Measuring where verifications actually come from leaves one source: the remote
MCP server. An interactive MCP client (Claude Desktop, Cursor, claude.ai)
authenticates with a Clerk OAuth access token, and this account issues those in
Clerk's opaque `oat_...` format, which can only be checked by calling
`POST /v1/oauth_applications/access_tokens/verify` on Clerk's Backend API. The
client re-presents the same token on every JSON-RPC message, so `initialize`,
each `tools/list`, and every `tools/call` each cost a verification. A single
chat turn spends dozens on one token.

There was nowhere to cache that. `clerkMiddleware` matched every path except
static assets, and it calls `authenticateRequest` with `acceptsToken: "any"`
before any route code runs. By the time `/mcp` could look at the result — via
`auth({ acceptsToken: "oauth_token" })`, which only reads headers the middleware
had already populated — the verification was over and paid for.

## Decision

**Take Clerk off the machine-credential routes entirely, and cache the one
verification that remains.**

`proxy.ts` stops matching `api/v1/`, `mcp` and `.well-known/`. All three carry
machine credentials rather than a Clerk session, and none of them calls `auth()`
— so running `clerkMiddleware` there only ever bought a session lookup with no
session to find. This is what removes Clerk from the host's hot path for good:
the polling traffic GEN-444 pointed at no longer reaches Clerk code at all,
rather than reaching it and happening not to spend anything.

`lib/mcp/auth.ts` therefore verifies the OAuth token itself, calling
`authenticateRequest({ acceptsToken: "oauth_token" })` on a `clerkClient()` — the
same call the middleware made, on a client configured from the same environment.
Because that call now happens inside the route, `cacheOAuthTokenVerification`
can wrap it.

**The cache is keyed by SHA-256 of the token and holds an entry for 60 seconds.**
The window is the whole design: it collapses a burst of tool calls onto a single
verification, which is where the spend is, while bounding how long a revoked
token keeps working to something an operator cannot distinguish from ordinary
propagation delay. Two tiers sit behind one interface — an in-process map, which
does most of the work because consecutive messages of a session land on the same
warm instance, and Upstash Redis, which finally gives `lib/redis.ts` a caller
again and covers cold starts and redeploys. Both degrade to "ask Clerk" on
failure; a cache outage must never turn into a failed MCP request.

**Only successful verifications are cached.** A rejection is the cheap case —
the client re-runs the OAuth flow instead of retrying a dead token — and caching
it would lock out a token Clerk had merely not finished propagating for the full
window.

**The token itself never leaves the process.** Upstash is a separate service,
and an entry holding the token verbatim would turn a Redis dump into a set of
live credentials, so the key is a hash, the same one-way treatment host
credentials get in `hosts.credential_hash`.

## Consequences

Measured against a stubbed Clerk Backend API, five `tools/list` calls carrying
one token fall from five verifications to one; the ratio improves with burst
size, and the pre-change behaviour was exactly one verification per request.

A revoked or expired OAuth token stays usable for up to 60 seconds. That is the
price of the cache and the reason the window is short.

Host credentials are unaffected — they were already Clerk-free — and pages still
sit behind `clerkMiddleware`, which continues to guard `/home`, `/issues` and
`/settings`.

The remaining lever, if the allowance is ever threatened again, is Clerk's
JWT-format OAuth access tokens: those verify locally against the JWKS and are
not metered at all. `authenticateRequest` already handles that format, so
switching the Clerk OAuth application over is a dashboard change rather than a
code change.
