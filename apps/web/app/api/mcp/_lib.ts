import type { AuthInfo } from "@modelcontextprotocol/sdk/server/auth/types.js"
import { createServiceClient } from "@gentic/supabase/service"
import { z } from "zod"

import { ServiceError } from "@/lib/services/errors"

export function resolveMcpUserId(authInfo: AuthInfo | undefined): string {
  const userId = authInfo?.extra?.userId

  if (typeof userId !== "string") {
    throw new Error("MCP auth info is missing a Clerk user id")
  }

  return userId
}

export function getMcpToolContext(authInfo: AuthInfo | undefined) {
  return {
    userId: resolveMcpUserId(authInfo),
    supabase: createServiceClient(),
  }
}

export function mcpJsonResult(data: Record<string, unknown>) {
  return {
    content: [{ type: "text" as const, text: JSON.stringify(data) }],
    structuredContent: data,
  }
}

export function mcpErrorResult(error: unknown) {
  if (error instanceof ServiceError) {
    return {
      isError: true,
      content: [{ type: "text" as const, text: error.message }],
    }
  }

  if (error instanceof z.ZodError) {
    return {
      isError: true,
      content: [{ type: "text" as const, text: "Invalid request" }],
    }
  }

  console.error("[mcp] tool failed:", error)
  return {
    isError: true,
    content: [{ type: "text" as const, text: "Internal server error" }],
  }
}
