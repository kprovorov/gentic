import {
  authServerMetadataHandlerClerk,
  metadataCorsOptionsRequestHandler,
} from "@clerk/mcp-tools/next"

export const runtime = "nodejs"

const handler = authServerMetadataHandlerClerk()

export { handler as GET }
export const OPTIONS = metadataCorsOptionsRequestHandler()
