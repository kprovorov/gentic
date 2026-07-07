import { withGenticMcpAuth } from "@/lib/mcp/auth"
import { apiMcpHandler } from "@/lib/mcp/handler"

export const runtime = "nodejs"

const handler = withGenticMcpAuth(apiMcpHandler)

export { handler as GET, handler as POST }
