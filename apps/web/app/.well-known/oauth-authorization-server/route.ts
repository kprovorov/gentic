import {
  authServerMetadataHandlerClerk,
  metadataCorsOptionsRequestHandler,
} from "@clerk/mcp-tools/next"

const handler = authServerMetadataHandlerClerk()

export { handler as GET }

export function OPTIONS(): Response | Promise<Response> {
  const preflightHandler = metadataCorsOptionsRequestHandler()
  return preflightHandler()
}
