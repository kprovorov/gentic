import { verifyClerkToken } from "@clerk/mcp-tools/next"
import { auth } from "@clerk/nextjs/server"
import { withMcpAuth } from "mcp-handler"

import { createGenticMcpHandler } from "./handler"

type VerifyClerkTokenAuth = Parameters<typeof verifyClerkToken>[0]

const mcpHandler = createGenticMcpHandler()

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
