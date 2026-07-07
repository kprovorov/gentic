import { verifyClerkToken } from "@clerk/mcp-tools/next"
import { auth } from "@clerk/nextjs/server"
import { withMcpAuth } from "mcp-handler"

type VerifyClerkTokenAuth = Parameters<typeof verifyClerkToken>[0]

export function withGenticMcpAuth(handler: (request: Request) => Promise<Response>) {
  return withMcpAuth(
    handler,
    async (_request, bearerToken) =>
      verifyClerkToken(
        (await auth({
          acceptsToken: "oauth_token" as never,
        })) as unknown as VerifyClerkTokenAuth,
        bearerToken
      ),
    { required: true }
  )
}
