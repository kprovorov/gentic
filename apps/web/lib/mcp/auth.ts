import { verifyClerkToken } from "@clerk/mcp-tools/next"
import { auth } from "@clerk/nextjs/server"
import { withMcpAuth } from "mcp-handler"

import { createGenticMcpHandler } from "./handler"
import {
  createMcpTokenVerifier,
  defaultMcpTokenVerifierDeps,
  type McpTokenVerifier,
} from "./token-verifier"

type VerifyClerkTokenAuth = Parameters<typeof verifyClerkToken>[0]

const mcpHandler = createGenticMcpHandler()

const verifyOAuthToken: McpTokenVerifier = async (_request, bearerToken) =>
  verifyClerkToken(
    (await auth({
      acceptsToken: "oauth_token" as never,
    })) as unknown as VerifyClerkTokenAuth,
    bearerToken
  )

export const authenticatedMcpHandler = withMcpAuth(
  mcpHandler,
  createMcpTokenVerifier({
    ...defaultMcpTokenVerifierDeps,
    verifyOAuthToken,
  }),
  { required: true }
)
