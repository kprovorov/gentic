import type { AuthInfo } from "@modelcontextprotocol/sdk/server/auth/types.js"
import { clerkMiddleware } from "@clerk/express"
import {
  authServerMetadataHandlerClerk,
  mcpAuthClerk,
  protectedResourceHandlerClerk,
} from "@clerk/mcp-tools/express"
import express from "express"

import { mcpHandler } from "./mcp"

type AuthenticatedRequest = Request & { auth?: AuthInfo }

const app = express()
const port = Number(process.env.PORT ?? 3000)

app.set("trust proxy", true)
app.use(express.json({ limit: "1mb", type: ["application/json", "application/*+json"] }))

app.get("/health", (_, res) => {
  res.json({ ok: true })
})

app.use(clerkMiddleware())

app.get(
  /^\/\.well-known\/oauth-protected-resource(?:\/.*)?$/,
  protectedResourceHandlerClerk({
    service_documentation: "https://gentic.chat",
  })
)
app.get("/.well-known/oauth-authorization-server", authServerMetadataHandlerClerk)

function toWebHeaders(headers: express.Request["headers"]): Headers {
  const webHeaders = new Headers()

  for (const [key, value] of Object.entries(headers)) {
    if (typeof value === "string") {
      webHeaders.set(key, value)
    } else if (Array.isArray(value)) {
      for (const headerValue of value) {
        webHeaders.append(key, headerValue)
      }
    }
  }

  return webHeaders
}

function toWebRequest(req: express.Request, handlerPath: string): Request {
  const protocol = req.protocol
  const host = req.get("host")
  const url = new URL(`${protocol}://${host}${req.originalUrl}`)
  url.pathname = handlerPath

  const request = new Request(url, {
    method: req.method,
    headers: toWebHeaders(req.headers),
    body:
      req.method !== "GET" && req.method !== "HEAD"
        ? JSON.stringify(req.body ?? {})
        : undefined,
  })

  const authenticatedRequest = request as AuthenticatedRequest
  authenticatedRequest.auth = (req as express.Request & { auth?: AuthInfo }).auth

  return request
}

async function handleMcpRequest(req: express.Request, res: express.Response) {
  try {
    const webResponse = await mcpHandler(toWebRequest(req, "/mcp"))

    res.status(webResponse.status)
    webResponse.headers.forEach((value, key) => {
      res.setHeader(key, value)
    })

    const body = await webResponse.text()
    res.send(body)
  } catch (error) {
    console.error("[mcp] request failed:", error)
    res.status(500).json({ error: "Internal server error" })
  }
}

app.all("/", mcpAuthClerk, (req, res) => handleMcpRequest(req, res))

if (!process.env.VERCEL) {
  app.listen(port, () => {
    console.log(`[mcp] listening on http://localhost:${port}`)
  })
}

export default app
