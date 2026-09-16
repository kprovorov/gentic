import { createHash } from "node:crypto"

import { getRedis } from "@/lib/redis"

import type { McpTokenVerifier } from "./token-verifier"

/**
 * How long a verified Clerk OAuth token is trusted without re-asking Clerk.
 *
 * Clerk meters machine-auth verification, and an opaque `oat_...` token can
 * only be checked by calling `POST /v1/oauth_applications/access_tokens/verify`
 * on the Backend API. MCP clients re-present the same access token on every
 * JSON-RPC message, so one chat turn spends a verification per `tools/list`
 * and per `tools/call` — the account-level overrun GEN-444 reports.
 *
 * A minute collapses a burst of tool calls onto a single verification while
 * keeping the window in which a revoked token still works short enough to be
 * indistinguishable from ordinary propagation delay.
 */
export const OAUTH_TOKEN_CACHE_TTL_MS = 60_000

/**
 * Ceiling on the in-process tier. Entries are ~200 bytes and expire in a
 * minute, so this only matters if a single instance sees thousands of distinct
 * tokens at once; evicting the oldest keeps memory bounded rather than exact.
 */
const MAX_LOCAL_ENTRIES = 1_000

const CACHE_KEY_PREFIX = "mcp:oauth-token:"

/**
 * A best-effort key/value tier. Both implementations below swallow their own
 * failures: a cache that is down must degrade to "ask Clerk", never to "reject
 * the request".
 */
export interface OAuthTokenCacheStore {
  get(key: string): Promise<string | null>
  set(key: string, value: string, ttlMs: number): Promise<void>
}

interface CachedVerification {
  userId: string
  clientId: string
  scopes: string[]
}

type LocalEntry = { value: string; expiresAt: number }

/**
 * Per-instance tier. On a serverless deployment this is the one that does the
 * work — consecutive messages of an MCP session usually land on the same warm
 * instance — and it costs nothing when Redis isn't configured.
 */
export function createLocalOAuthTokenCacheStore(
  now: () => number = Date.now
): OAuthTokenCacheStore {
  const localEntries = new Map<string, LocalEntry>()

  return {
    async get(key) {
      const entry = localEntries.get(key)

      if (!entry) {
        return null
      }
      if (entry.expiresAt <= now()) {
        localEntries.delete(key)
        return null
      }
      return entry.value
    },
    async set(key, value, ttlMs) {
      // Re-inserting moves the key to the end of the iteration order, so the
      // eviction below always drops the least recently written entry.
      localEntries.delete(key)

      if (localEntries.size >= MAX_LOCAL_ENTRIES) {
        const oldest = localEntries.keys().next()
        if (!oldest.done) {
          localEntries.delete(oldest.value)
        }
      }

      localEntries.set(key, { value, expiresAt: now() + ttlMs })
    },
  }
}

/**
 * Shared tier, so a fleet of instances (or a redeploy) doesn't re-verify a
 * token each has already seen. `getRedis()` returns `null` when Upstash isn't
 * configured — local dev, tests — which degrades to the local tier alone.
 */
export function createRedisOAuthTokenCacheStore(): OAuthTokenCacheStore {
  return {
    async get(key) {
      const redis = getRedis()
      if (!redis) {
        return null
      }

      try {
        return await redis.get<string>(key)
      } catch (error) {
        console.error("[mcp-auth] OAuth token cache read failed:", error)
        return null
      }
    },
    async set(key, value, ttlMs) {
      const redis = getRedis()
      if (!redis) {
        return
      }

      try {
        await redis.set(key, value, { px: ttlMs })
      } catch (error) {
        console.error("[mcp-auth] OAuth token cache write failed:", error)
      }
    },
  }
}

/** Reads hit the tiers in order; writes fan out to all of them. */
export function createTieredOAuthTokenCacheStore(
  tiers: OAuthTokenCacheStore[]
): OAuthTokenCacheStore {
  return {
    async get(key) {
      for (const tier of tiers) {
        const value = await tier.get(key)
        if (value !== null) {
          return value
        }
      }
      return null
    },
    async set(key, value, ttlMs) {
      await Promise.all(tiers.map((tier) => tier.set(key, value, ttlMs)))
    },
  }
}

export interface OAuthTokenCacheOptions {
  store?: OAuthTokenCacheStore
  ttlMs?: number
}

/**
 * Wraps an OAuth token verifier so repeated presentations of the same token
 * cost one Clerk verification per {@link OAUTH_TOKEN_CACHE_TTL_MS} window
 * instead of one per request.
 *
 * Only successful verifications are cached. A rejection is the cheap case — the
 * client re-runs the OAuth flow rather than retrying the dead token — and
 * caching it would keep a token that Clerk had merely not finished propagating
 * locked out for the whole window.
 */
export function cacheOAuthTokenVerification(
  verify: McpTokenVerifier,
  options: OAuthTokenCacheOptions = {}
): McpTokenVerifier {
  const store =
    options.store ??
    createTieredOAuthTokenCacheStore([
      createLocalOAuthTokenCacheStore(),
      createRedisOAuthTokenCacheStore(),
    ])
  const ttlMs = options.ttlMs ?? OAUTH_TOKEN_CACHE_TTL_MS

  return async (request, bearerToken) => {
    if (!bearerToken) {
      return verify(request, bearerToken)
    }

    const key = cacheKey(bearerToken)
    const cached = parseCached(await read(store, key))

    if (cached) {
      return {
        token: bearerToken,
        clientId: cached.clientId,
        scopes: cached.scopes,
        extra: { userId: cached.userId },
      }
    }

    const authInfo = await verify(request, bearerToken)
    const cacheable = toCacheable(authInfo)

    if (cacheable) {
      await write(store, key, JSON.stringify(cacheable), ttlMs)
    }

    return authInfo
  }
}

// A cache outage must degrade to "ask Clerk", never to a failed MCP request —
// the same contract `getRedis()` documents. The shipped tiers already swallow
// their own failures; these guard an injected store and anything they miss.

async function read(
  store: OAuthTokenCacheStore,
  key: string
): Promise<string | null> {
  try {
    return await store.get(key)
  } catch (error) {
    console.error("[mcp-auth] OAuth token cache lookup failed:", error)
    return null
  }
}

async function write(
  store: OAuthTokenCacheStore,
  key: string,
  value: string,
  ttlMs: number
): Promise<void> {
  try {
    await store.set(key, value, ttlMs)
  } catch (error) {
    console.error("[mcp-auth] OAuth token cache store failed:", error)
  }
}

/**
 * The bearer token never leaves the process: Upstash is a separate service, and
 * a cache entry that held the token verbatim would turn a Redis dump into a set
 * of live credentials. SHA-256 is the same one-way treatment host credentials
 * get in `hosts.credential_hash`.
 */
function cacheKey(bearerToken: string): string {
  return (
    CACHE_KEY_PREFIX + createHash("sha256").update(bearerToken).digest("hex")
  )
}

function toCacheable(
  authInfo: Awaited<ReturnType<McpTokenVerifier>>
): CachedVerification | null {
  const userId = authInfo?.extra?.userId

  if (typeof userId !== "string" || !authInfo?.clientId) {
    return null
  }

  return {
    userId,
    clientId: authInfo.clientId,
    scopes: authInfo.scopes ?? [],
  }
}

function parseCached(value: string | null): CachedVerification | null {
  if (!value) {
    return null
  }

  try {
    const parsed: unknown = JSON.parse(value)

    if (
      typeof parsed !== "object" ||
      parsed === null ||
      typeof (parsed as CachedVerification).userId !== "string" ||
      typeof (parsed as CachedVerification).clientId !== "string" ||
      !Array.isArray((parsed as CachedVerification).scopes)
    ) {
      return null
    }

    return parsed as CachedVerification
  } catch {
    // A malformed entry is indistinguishable from a cache miss: re-verify.
    return null
  }
}
