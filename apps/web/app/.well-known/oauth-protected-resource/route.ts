import {
  metadataCorsOptionsRequestHandler,
  protectedResourceHandlerClerk,
} from "@clerk/mcp-tools/next"

export const runtime = "nodejs"

const handler = protectedResourceHandlerClerk({
  service_documentation: "https://gentic.chat",
})

export { handler as GET }
export const OPTIONS = metadataCorsOptionsRequestHandler()
