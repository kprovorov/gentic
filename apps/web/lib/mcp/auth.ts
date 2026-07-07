import { verifyClerkToken } from "@clerk/mcp-tools/next"
import { auth } from "@clerk/nextjs/server"
import { withMcpAuth } from "mcp-handler"

import { mcpHandler } from "./handler"

type VerifyClerkTokenAuth = Parameters<typeof verifyClerkToken>[0]

export const authenticatedMcpHandler = withMcpAuth(
  mcpHandler,
  async (_request, bearerToken) =>
    verifyClerkToken(
      (await auth({
        acceptsToken: "oauth_token" as never,
      })) as unknown as VerifyClerkTokenAuth,
      bearerToken
    ),
  { required: true }
)
