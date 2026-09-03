import type { AuthInfo } from "@modelcontextprotocol/sdk/server/auth/types.js"

import { ServiceError } from "@gentic/services/errors"
import { authenticateHostCredential } from "@gentic/services/hosts"
import { createServiceClient } from "@gentic/supabase/service"

/**
 * Prefix carried by every host credential minted at enrollment. Still spelled
 * "gtwc" (gentic worker credential) after GEN-435: credentials are stored
 * hashed, so the literal is frozen by every credential already issued. See
 * `CREDENTIAL_PREFIX` in `@gentic/services/hosts`.
 */
export const HOST_CREDENTIAL_PREFIX = "gtwc_"

export type McpTokenVerifier = (
  request: Request,
  bearerToken?: string
) => Promise<AuthInfo | undefined>

export interface McpTokenVerifierDeps {
  authenticateHostCredential: typeof authenticateHostCredential
  createServiceClient: typeof createServiceClient
  /** Verifier for the pre-existing Clerk OAuth path. */
  verifyOAuthToken: McpTokenVerifier
}

/**
 * True for bearer tokens shaped like a host credential. Clerk OAuth tokens
 * never carry this prefix, so the two credential families stay disjoint and a
 * token is only ever checked against the store it belongs to.
 */
export function isHostCredentialToken(bearerToken: string): boolean {
  return bearerToken.startsWith(HOST_CREDENTIAL_PREFIX)
}

/**
 * Resolves an MCP bearer token to the Gentic account that authorized it.
 *
 * Two credential families reach the same endpoint:
 *   - Clerk OAuth tokens from interactive MCP clients (Claude Desktop, Cursor).
 *   - Host credentials (`gtwc_...`) presented by managed coding agents.
 *
 * Both resolve to a Clerk `user_id` in `extra.userId`, which is the only
 * identity the tool registry reads — so a host-authenticated agent gets the
 * owner's normal account-wide access, no more and no less.
 *
 * Routing is by prefix and is one-way: a `gtwc_` token that fails verification
 * is rejected outright rather than retried against Clerk, so neither path can
 * be used to probe the other.
 */
export function createMcpTokenVerifier(
  deps: McpTokenVerifierDeps
): McpTokenVerifier {
  return async (request, bearerToken) => {
    if (!bearerToken) {
      return undefined
    }

    if (isHostCredentialToken(bearerToken)) {
      return verifyHostCredentialToken(bearerToken, deps)
    }

    return deps.verifyOAuthToken(request, bearerToken)
  }
}

async function verifyHostCredentialToken(
  bearerToken: string,
  deps: McpTokenVerifierDeps
): Promise<AuthInfo | undefined> {
  try {
    // Banned hosts and expired credentials are rejected by the same
    // credential controls the agent REST API relies on: `allowBanned` stays
    // off, and `credential_expires_at` is enforced inside the lookup.
    const { userId, hostId } = await deps.authenticateHostCredential(
      deps.createServiceClient(),
      bearerToken
    )

    return {
      token: bearerToken,
      clientId: `host:${hostId}`,
      scopes: [],
      extra: { userId, hostId },
    }
  } catch (error) {
    if (error instanceof ServiceError && error.code === "forbidden") {
      // Undefined makes `withMcpAuth` answer 401 without disclosing whether
      // the credential was unknown, revoked, banned, or expired.
      return undefined
    }
    throw error
  }
}

export const defaultMcpTokenVerifierDeps = {
  authenticateHostCredential,
  createServiceClient,
} satisfies Omit<McpTokenVerifierDeps, "verifyOAuthToken">
