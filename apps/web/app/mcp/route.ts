import { authenticatedMcpHandler } from "@/lib/mcp/auth"

export const runtime = "nodejs"

export {
  authenticatedMcpHandler as GET,
  authenticatedMcpHandler as POST,
}
