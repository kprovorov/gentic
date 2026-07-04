import { verifyClerkToken } from "@clerk/mcp-tools/next"
import { auth } from "@clerk/nextjs/server"
import { createMcpHandler, withMcpAuth } from "mcp-handler"
import { z } from "zod"
import { resolveMcpUserId } from "./_lib"

const handler = createMcpHandler(
  (server) => {
    server.registerTool(
      "whoami",
      {
        description:
          "Returns the Clerk user id of the account that authorized this MCP connection",
        outputSchema: { userId: z.string() },
      },
      async ({ authInfo }) => {
        const userId = resolveMcpUserId(authInfo)

        return {
          content: [{ type: "text", text: JSON.stringify({ userId }) }],
          structuredContent: { userId },
        }
      }
    )
  },
  {},
  { basePath: "/api" }
)

const authHandler = withMcpAuth(
  handler,
  async (_, token) => {
    const clerkAuth = await auth({ acceptsToken: "oauth_token" })
    return verifyClerkToken(clerkAuth, token)
  },
  { required: true }
)

export { authHandler as GET, authHandler as POST }
