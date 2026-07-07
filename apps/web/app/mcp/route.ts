import { withGenticMcpAuth } from "@/lib/mcp/auth"
import { rootMcpHandler } from "@/lib/mcp/handler"

export const runtime = "nodejs"

const handler = withGenticMcpAuth(rootMcpHandler)

export { handler as GET, handler as POST }
