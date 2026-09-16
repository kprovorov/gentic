import { verifyClerkToken } from "@clerk/mcp-tools/next"
import { clerkClient } from "@clerk/nextjs/server"
import { withMcpAuth } from "mcp-handler"

import { createGenticMcpHandler } from "./handler"
import { cacheOAuthTokenVerification } from "./oauth-token-cache"
import {
  createMcpTokenVerifier,
  defaultMcpTokenVerifierDeps,
  type McpTokenVerifier,
} from "./token-verifier"

type VerifyClerkTokenAuth = Parameters<typeof verifyClerkToken>[0]

const mcpHandler = createGenticMcpHandler()

/**
 * Resolves a Clerk OAuth access token to its owner.
 *
 * This used to read the auth object `clerkMiddleware` had already produced, via
 * `auth({ acceptsToken: "oauth_token" })`. The middleware runs before any route
 * code, so the Clerk verification was over and paid for by the time the handler
 * could look at it — which left nowhere to put a cache. `/mcp` is now outside
 * the `proxy.ts` matcher (see GEN-444) and this is the single place a token is
 * exchanged for an identity, so {@link cacheOAuthTokenVerification} can sit in
 * front of it.
 *
 * `authenticateRequest` is the same call the middleware made, on a client
 * `clerkClient()` configures from the same environment (`CLERK_API_URL`, proxy
 * and satellite settings included). It verifies a JWT-format access token
 * locally against the JWKS, and only falls back to Clerk's Backend API for the
 * opaque `oat_...` format that this account issues today.
 */
const verifyOAuthToken: McpTokenVerifier = async (request, bearerToken) => {
  const clerk = await clerkClient()
  const requestState = await clerk.authenticateRequest(request, {
    acceptsToken: "oauth_token",
  })

  return verifyClerkToken(
    requestState.toAuth() as unknown as VerifyClerkTokenAuth,
    bearerToken
  )
}

export const authenticatedMcpHandler = withMcpAuth(
  mcpHandler,
  createMcpTokenVerifier({
    ...defaultMcpTokenVerifierDeps,
    verifyOAuthToken: cacheOAuthTokenVerification(verifyOAuthToken),
  }),
  { required: true }
)
