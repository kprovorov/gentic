import type { McpServer } from "@agentclientprotocol/sdk"

/**
 * Name the Gentic MCP server is registered under inside each agent session.
 * Both providers key their server maps by name, so keeping it stable means a
 * resumed session re-attaches the same server instead of adding a duplicate.
 */
export const GENTIC_MCP_SERVER_NAME = "gentic"

/** Path the remote MCP server is mounted at, relative to the app origin. */
const GENTIC_MCP_PATH = "/mcp"

/** The Gentic endpoint is always reached over streamable HTTP. */
export type GenticMcpServer = Extract<McpServer, { type: "http" }>

/** Credentials a host uses to reach its owner's Gentic MCP endpoint. */
export interface GenticMcpAccess {
  /** `GENTIC_API_URL`, e.g. `https://app.gentic.chat/api/v1`. */
  apiUrl: string
  /** The host credential (`gtwc_...`) this host authenticates with. */
  credential: string
}

/**
 * Builds the HTTP MCP server entry for the owner's Gentic account.
 *
 * The endpoint lives at the app origin (`/mcp`), not under the versioned agent
 * API path, so it is resolved against the origin of `GENTIC_API_URL` rather
 * than appended to it. The host credential travels as a bearer token; the
 * web app resolves it to the same account a Clerk-authorized MCP client gets.
 *
 * Returns `null` when the access details are unusable, so a misconfigured
 * host still runs its agent — just without Gentic tools — instead of failing
 * every session on a URL parse error.
 */
export function genticMcpServer(
  access: GenticMcpAccess
): GenticMcpServer | null {
  const url = genticMcpUrl(access.apiUrl)
  if (!url || !access.credential) {
    return null
  }

  return {
    type: "http",
    name: GENTIC_MCP_SERVER_NAME,
    url,
    headers: [{ name: "Authorization", value: `Bearer ${access.credential}` }],
  }
}

/**
 * Adds the Gentic MCP server to `servers` without disturbing what is already
 * there: entries the caller supplied are preserved, and an existing server
 * with the same name wins so an explicit override is never clobbered.
 *
 * Provider-level MCP configuration (`.mcp.json`, `~/.codex/config.toml`) is
 * untouched — both ACP agents merge session-scoped servers into the user's own
 * configuration rather than replacing it.
 */
export function withGenticMcpServer(
  servers: McpServer[],
  access: GenticMcpAccess | null | undefined
): McpServer[] {
  if (!access) {
    return servers
  }

  const gentic = genticMcpServer(access)
  if (!gentic || servers.some((server) => server.name === gentic.name)) {
    return servers
  }

  return [...servers, gentic]
}

function genticMcpUrl(apiUrl: string): string | null {
  try {
    return new URL(GENTIC_MCP_PATH, apiUrl).toString()
  } catch {
    return null
  }
}
