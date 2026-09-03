import assert from "node:assert/strict"
import test from "node:test"

import { ServiceError } from "@gentic/services/errors"
import {
  authenticateHostCredential,
  hashHostSecret,
} from "@gentic/services/hosts"

import { resolveMcpUserId } from "../lib/mcp/lib"
import {
  createMcpTokenVerifier,
  isHostCredentialToken,
  HOST_CREDENTIAL_PREFIX,
  type McpTokenVerifier,
} from "../lib/mcp/token-verifier"

const now = new Date("2026-01-01T00:00:00.000Z")
const request = new Request("https://app.gentic.chat/mcp", { method: "POST" })

const activeCredential = `${HOST_CREDENTIAL_PREFIX}${"a".repeat(43)}`
const bannedCredential = `${HOST_CREDENTIAL_PREFIX}${"b".repeat(43)}`
const expiredCredential = `${HOST_CREDENTIAL_PREFIX}${"c".repeat(43)}`
const unknownCredential = `${HOST_CREDENTIAL_PREFIX}${"d".repeat(43)}`

type HostRow = {
  id: string
  user_id: string
  banned_at: string | null
  credential_hash: string
  credential_expires_at: string | null
}

const hosts: HostRow[] = [
  {
    id: "host-1",
    user_id: "user_owner",
    banned_at: null,
    credential_hash: hashHostSecret(activeCredential),
    credential_expires_at: null,
  },
  {
    id: "host-2",
    user_id: "user_owner",
    banned_at: now.toISOString(),
    credential_hash: hashHostSecret(bannedCredential),
    credential_expires_at: null,
  },
  {
    id: "host-3",
    user_id: "user_owner",
    banned_at: null,
    credential_hash: hashHostSecret(expiredCredential),
    credential_expires_at: new Date(now.getTime() - 1).toISOString(),
  },
]

/** Minimal stand-in for the credential lookup the service client performs. */
function fakeServiceClient() {
  return {
    from() {
      return {
        select() {
          return {
            eq(_column: string, value: string) {
              return {
                maybeSingle() {
                  return {
                    returns: async () => ({
                      data:
                        hosts.find((host) => host.credential_hash === value) ??
                        null,
                      error: null,
                    }),
                  }
                },
              }
            },
          }
        },
      }
    },
  }
}

function verifier(
  options: {
    verifyOAuthToken?: McpTokenVerifier
    createServiceClient?: () => unknown
  } = {}
): {
  verify: McpTokenVerifier
  oauthCalls: (string | undefined)[]
} {
  const oauthCalls: (string | undefined)[] = []

  const verify = createMcpTokenVerifier({
    createServiceClient: (options.createServiceClient ??
      fakeServiceClient) as never,
    // Deliberately the real credential check, so this covers the same
    // ban/expiry controls the agent REST API relies on.
    authenticateHostCredential: ((supabase: never, credential: string) =>
      authenticateHostCredential(supabase, credential, { now })) as never,
    verifyOAuthToken:
      options.verifyOAuthToken ??
      (async (_req, bearerToken) => {
        oauthCalls.push(bearerToken)
        return {
          token: bearerToken ?? "",
          clientId: "clerk-client",
          scopes: [],
          extra: { userId: "user_clerk" },
        }
      }),
  })

  return { verify, oauthCalls }
}

test("host credentials are recognized by prefix only", () => {
  assert.equal(isHostCredentialToken(activeCredential), true)
  assert.equal(isHostCredentialToken("clerk_oauth_token"), false)
  assert.equal(isHostCredentialToken(`x${activeCredential}`), false)
})

test("a valid host credential resolves to the host owner", async () => {
  const { verify, oauthCalls } = verifier()

  const authInfo = await verify(request, activeCredential)

  assert.ok(authInfo)
  assert.equal(resolveMcpUserId(authInfo), "user_owner")
  assert.deepEqual(authInfo.extra, {
    userId: "user_owner",
    hostId: "host-1",
  })
  assert.equal(authInfo.token, activeCredential)
  assert.equal(authInfo.clientId, "host:host-1")
  // Account-wide access comes from the resolved owner, exactly as it does for
  // a Clerk client — a host credential never smuggles in extra scopes.
  assert.deepEqual(authInfo.scopes, [])
  assert.deepEqual(oauthCalls, [])
})

test("banned, expired, unknown, and malformed host credentials are rejected", async () => {
  for (const credential of [
    bannedCredential,
    expiredCredential,
    unknownCredential,
    `${HOST_CREDENTIAL_PREFIX}short`,
  ]) {
    const { verify, oauthCalls } = verifier()

    assert.equal(await verify(request, credential), undefined, credential)
    // A failed host credential is never retried against Clerk.
    assert.deepEqual(oauthCalls, [])
  }
})

test("unexpected credential-store failures are not treated as anonymous", async () => {
  const { verify } = verifier({
    createServiceClient: () => ({
      from: () => ({
        select: () => ({
          eq: () => ({
            maybeSingle: () => ({
              returns: async () => ({
                data: null,
                error: { message: "database unavailable" },
              }),
            }),
          }),
        }),
      }),
    }),
  })

  await assert.rejects(
    () => verify(request, activeCredential),
    (error: unknown) =>
      error instanceof ServiceError && error.code === "internal"
  )
})

test("non-host tokens keep flowing through the Clerk OAuth path", async () => {
  const { verify, oauthCalls } = verifier()

  const authInfo = await verify(request, "clerk_oauth_token")

  assert.ok(authInfo)
  assert.equal(resolveMcpUserId(authInfo), "user_clerk")
  assert.deepEqual(oauthCalls, ["clerk_oauth_token"])
})

test("a rejected Clerk token stays rejected", async () => {
  const { verify } = verifier({
    verifyOAuthToken: async () => undefined,
  })

  assert.equal(await verify(request, "clerk_oauth_token"), undefined)
})

test("a missing bearer token authenticates neither path", async () => {
  const { verify, oauthCalls } = verifier()

  assert.equal(await verify(request, undefined), undefined)
  assert.deepEqual(oauthCalls, [])
})

test("both auth paths resolve to a tool-context user id", async () => {
  const { verify } = verifier()

  const host = await verify(request, activeCredential)
  const clerk = await verify(request, "clerk_oauth_token")

  assert.ok(host)
  assert.ok(clerk)
  assert.equal(resolveMcpUserId(host), "user_owner")
  assert.equal(resolveMcpUserId(clerk), "user_clerk")
})
