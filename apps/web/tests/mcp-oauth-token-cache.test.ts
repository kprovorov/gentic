import assert from "node:assert/strict"
import test from "node:test"

import { resolveMcpUserId } from "../lib/mcp/lib"
import {
  cacheOAuthTokenVerification,
  createLocalOAuthTokenCacheStore,
  createTieredOAuthTokenCacheStore,
  OAUTH_TOKEN_CACHE_TTL_MS,
  type OAuthTokenCacheStore,
} from "../lib/mcp/oauth-token-cache"
import type { McpTokenVerifier } from "../lib/mcp/token-verifier"

const request = new Request("https://app.gentic.chat/mcp", { method: "POST" })

const oauthToken = "oat_live_token"
const otherOauthToken = "oat_live_other_token"

/**
 * Stands in for the Clerk Backend API round trip. Every call recorded here is a
 * verification Clerk would have metered.
 */
function clerkVerifier(
  users: Record<string, string> = { [oauthToken]: "user_clerk" }
): { verify: McpTokenVerifier; calls: (string | undefined)[] } {
  const calls: (string | undefined)[] = []

  const verify: McpTokenVerifier = async (_req, bearerToken) => {
    calls.push(bearerToken)

    const userId = bearerToken ? users[bearerToken] : undefined
    if (!userId) {
      return undefined
    }

    return {
      token: bearerToken ?? "",
      clientId: "clerk-client",
      scopes: ["profile", "email"],
      extra: { userId },
    }
  }

  return { verify, calls }
}

/** A clock the tests advance by hand, so no test sleeps. */
function fakeClock(start = 0) {
  let current = start
  return {
    now: () => current,
    advance: (ms: number) => {
      current += ms
    },
  }
}

test("a repeated OAuth token is verified against Clerk only once per window", async () => {
  const clock = fakeClock()
  const { verify, calls } = clerkVerifier()
  const cached = cacheOAuthTokenVerification(verify, {
    store: createLocalOAuthTokenCacheStore(clock.now),
  })

  const first = await cached(request, oauthToken)
  const second = await cached(request, oauthToken)
  const third = await cached(request, oauthToken)

  assert.deepEqual(calls, [oauthToken])
  assert.ok(first)
  assert.ok(second)
  assert.ok(third)
  // A cache hit has to be indistinguishable from a fresh verification, since
  // the tool registry reads its identity straight off this object.
  assert.deepEqual(second, first)
  assert.equal(resolveMcpUserId(second), "user_clerk")
  assert.equal(second.token, oauthToken)
  assert.equal(second.clientId, "clerk-client")
  assert.deepEqual(second.scopes, ["profile", "email"])
})

test("a cached verification is dropped once its window closes", async () => {
  const clock = fakeClock()
  const { verify, calls } = clerkVerifier()
  const cached = cacheOAuthTokenVerification(verify, {
    store: createLocalOAuthTokenCacheStore(clock.now),
  })

  await cached(request, oauthToken)
  clock.advance(OAUTH_TOKEN_CACHE_TTL_MS - 1)
  await cached(request, oauthToken)
  assert.deepEqual(calls, [oauthToken])

  // Revocation takes effect within one window: past it, Clerk is asked again.
  clock.advance(1)
  await cached(request, oauthToken)
  assert.deepEqual(calls, [oauthToken, oauthToken])
})

test("each token gets its own cache entry", async () => {
  const clock = fakeClock()
  const { verify, calls } = clerkVerifier({
    [oauthToken]: "user_one",
    [otherOauthToken]: "user_two",
  })
  const cached = cacheOAuthTokenVerification(verify, {
    store: createLocalOAuthTokenCacheStore(clock.now),
  })

  const one = await cached(request, oauthToken)
  const two = await cached(request, otherOauthToken)
  await cached(request, oauthToken)

  assert.deepEqual(calls, [oauthToken, otherOauthToken])
  assert.ok(one)
  assert.ok(two)
  assert.equal(resolveMcpUserId(one), "user_one")
  assert.equal(resolveMcpUserId(two), "user_two")
})

test("a rejected token is never cached", async () => {
  const clock = fakeClock()
  const { verify, calls } = clerkVerifier()
  const cached = cacheOAuthTokenVerification(verify, {
    store: createLocalOAuthTokenCacheStore(clock.now),
  })

  assert.equal(await cached(request, "oat_unknown"), undefined)
  assert.equal(await cached(request, "oat_unknown"), undefined)

  // Caching a rejection would keep a token Clerk had merely not finished
  // propagating locked out for the whole window.
  assert.deepEqual(calls, ["oat_unknown", "oat_unknown"])
})

test("a missing bearer token is passed straight through", async () => {
  const clock = fakeClock()
  const { verify, calls } = clerkVerifier()
  const cached = cacheOAuthTokenVerification(verify, {
    store: createLocalOAuthTokenCacheStore(clock.now),
  })

  assert.equal(await cached(request, undefined), undefined)
  assert.deepEqual(calls, [undefined])
})

test("the bearer token is not recoverable from the cache key or value", async () => {
  const clock = fakeClock()
  const { verify } = clerkVerifier()
  const written: { key: string; value: string }[] = []
  const local = createLocalOAuthTokenCacheStore(clock.now)
  const recording: OAuthTokenCacheStore = {
    get: (key) => local.get(key),
    set: (key, value, ttlMs) => {
      written.push({ key, value })
      return local.set(key, value, ttlMs)
    },
  }

  await cacheOAuthTokenVerification(verify, { store: recording })(
    request,
    oauthToken
  )

  assert.equal(written.length, 1)
  // Upstash is a separate service: an entry holding the token verbatim would
  // turn a Redis dump into a set of live credentials.
  assert.ok(!written[0].key.includes(oauthToken))
  assert.ok(!written[0].value.includes(oauthToken))
  assert.match(written[0].key, /^mcp:oauth-token:[0-9a-f]{64}$/)
})

test("a failing cache degrades to verifying rather than to rejecting", async () => {
  const { verify, calls } = clerkVerifier()
  const broken: OAuthTokenCacheStore = {
    get: async () => {
      throw new Error("redis unavailable")
    },
    set: async () => {
      throw new Error("redis unavailable")
    },
  }

  const cached = cacheOAuthTokenVerification(verify, { store: broken })

  const authInfo = await cached(request, oauthToken)

  assert.ok(authInfo)
  assert.equal(resolveMcpUserId(authInfo), "user_clerk")
  assert.deepEqual(calls, [oauthToken])
})

test("a malformed cache entry is treated as a miss", async () => {
  const clock = fakeClock()
  const { verify, calls } = clerkVerifier()
  const corrupt: OAuthTokenCacheStore = {
    get: async () => "not json",
    set: async () => {},
  }

  const cached = cacheOAuthTokenVerification(verify, { store: corrupt })

  const authInfo = await cached(request, oauthToken)

  assert.ok(authInfo)
  assert.deepEqual(calls, [oauthToken])
  assert.equal(clock.now(), 0)
})

test("a tiered store serves from the first tier that has the entry", async () => {
  const clock = fakeClock()
  const { verify, calls } = clerkVerifier()
  const near = createLocalOAuthTokenCacheStore(clock.now)
  const far = createLocalOAuthTokenCacheStore(clock.now)
  const nearReads: string[] = []
  const farReads: string[] = []

  const store = createTieredOAuthTokenCacheStore([
    {
      get: (key) => {
        nearReads.push(key)
        return near.get(key)
      },
      set: (key, value, ttlMs) => near.set(key, value, ttlMs),
    },
    {
      get: (key) => {
        farReads.push(key)
        return far.get(key)
      },
      set: (key, value, ttlMs) => far.set(key, value, ttlMs),
    },
  ])

  const cached = cacheOAuthTokenVerification(verify, { store })

  await cached(request, oauthToken)
  const second = await cached(request, oauthToken)

  assert.ok(second)
  assert.deepEqual(calls, [oauthToken])
  // The write fanned out to both tiers, so the second read stops at the first.
  assert.equal(nearReads.length, 2)
  assert.equal(farReads.length, 1)
  assert.notEqual(await far.get(nearReads[0]), null)
})

test("a cold shared tier still spares Clerk a verification", async () => {
  const clock = fakeClock()
  const { verify, calls } = clerkVerifier()
  const shared = createLocalOAuthTokenCacheStore(clock.now)

  // Two instances, each with its own local tier over one shared tier — the
  // redeploy / cold-start case.
  const instanceOne = cacheOAuthTokenVerification(verify, {
    store: createTieredOAuthTokenCacheStore([
      createLocalOAuthTokenCacheStore(clock.now),
      shared,
    ]),
  })
  const instanceTwo = cacheOAuthTokenVerification(verify, {
    store: createTieredOAuthTokenCacheStore([
      createLocalOAuthTokenCacheStore(clock.now),
      shared,
    ]),
  })

  await instanceOne(request, oauthToken)
  const served = await instanceTwo(request, oauthToken)

  assert.ok(served)
  assert.equal(resolveMcpUserId(served), "user_clerk")
  assert.deepEqual(calls, [oauthToken])
})
