import type { AuthInfo } from "@modelcontextprotocol/sdk/server/auth/types.js"

export function resolveMcpUserId(authInfo: AuthInfo | undefined): string {
  const userId = authInfo?.extra?.userId

  if (typeof userId !== "string") {
    throw new Error("MCP auth info is missing a Clerk user id")
  }

  return userId
}
