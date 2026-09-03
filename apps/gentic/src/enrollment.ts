import { arch, hostname, platform } from "node:os"

import { hostCredentialSchema } from "@gentic/validators/hosts"
import { z } from "zod"

import packageJson from "../package.json" with { type: "json" }
import { getConfigInput } from "./config.js"
import { writeConfigFile } from "./config-store.js"
import { logError } from "./log.js"
import { getToolStatuses, type ToolStatuses } from "./tools.js"

export const DEFAULT_API_URL = "https://app.gentic.chat/api/v1"

const exchangeResponseSchema = z
  .object({
    api_url: z.string().url().optional(),
    host: z
      .object({
        id: z.string().min(1),
        display_name: z.string().min(1).optional(),
        setup_state: z.string().optional(),
      }),
    credential: hostCredentialSchema,
  })

export interface HostEnrollment {
  apiUrl: string
  hostId: string
  hostCredential: string
  displayName?: string
}

export interface ConnectHostDeps {
  fetch?: typeof fetch
  getTools?: () => Promise<ToolStatuses>
  hostname?: () => string
  now?: () => Date
}

export function suggestedHostName(
  getHostname: () => string = hostname
): string {
  const name = getHostname().trim()
  return name.length > 0 ? name : "Gentic Host"
}

export async function connectHostWithCode(
  code: string,
  options: {
    apiUrl?: string
    configuredCapacity?: number
  } = {},
  deps: ConnectHostDeps = {}
): Promise<HostEnrollment> {
  const apiUrl = (options.apiUrl ?? DEFAULT_API_URL).replace(/\/+$/, "")
  const getTools = deps.getTools ?? getToolStatuses
  const tools = await getTools()
  const response = await (deps.fetch ?? fetch)(
    `${apiUrl}/hosts/exchange`,
    {
      method: "POST",
      headers: {
        "content-type": "application/json",
      },
      body: JSON.stringify({
        code,
        display_name: suggestedHostName(deps.hostname),
        telemetry: {
          gentic_version: packageJson.version ?? null,
          os: platform(),
          arch: arch(),
          configured_capacity: options.configuredCapacity ?? 1,
          provider_capabilities: {
            providers: {
              claude_code: toolCapability(tools.claude),
              codex: toolCapability(tools.codex),
            },
          },
          process_started_at: (deps.now ?? (() => new Date()))().toISOString(),
        },
      }),
    }
  )
  const payload = await response.json().catch(() => null)

  if (!response.ok) {
    const retrySuffix =
      response.status === 429
        ? " Too many failed attempts; wait a few minutes and try again."
        : ""
    throw new Error(`Invalid or expired host connection code.${retrySuffix}`)
  }

  const parsed = exchangeResponseSchema.parse(payload)
  const enrollment = {
    apiUrl: (parsed.api_url ?? apiUrl).replace(/\/+$/, ""),
    hostId: parsed.host.id,
    hostCredential: parsed.credential,
    displayName: parsed.host.display_name,
  }

  writeConfigFile({
    GENTIC_API_URL: enrollment.apiUrl,
    GENTIC_HOST_ID: enrollment.hostId,
    GENTIC_HOST_CREDENTIAL: enrollment.hostCredential,
    GENTIC_HOST_SETUP_STATE: "setup-incomplete",
  })

  return enrollment
}

export async function markHostSetupReady(
  deps: {
    fetch?: typeof fetch
  } = {}
): Promise<void> {
  const config = getConfigInput()
  const apiUrl = config.GENTIC_API_URL
  const hostCredential = config.GENTIC_HOST_CREDENTIAL
  const hostId = config.GENTIC_HOST_ID
  const missing = [
    apiUrl ? null : "GENTIC_API_URL",
    hostCredential ? null : "GENTIC_HOST_CREDENTIAL",
    hostId ? null : "GENTIC_HOST_ID",
  ].filter((key): key is string => key !== null)
  if (!apiUrl || !hostCredential || !hostId) {
    logError(
      `cannot mark host setup ready: missing ${missing.join(" and ")}`
    )
    return
  }

  const response = await (deps.fetch ?? fetch)(
    `${apiUrl.replace(/\/+$/, "")}/agent/host/setup`,
    {
      method: "PATCH",
      headers: {
        authorization: `Bearer ${hostCredential}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({ setup_state: "ready" }),
    }
  )

  if (!response.ok) {
    const payload = await response.json().catch(() => null)
    const message =
      payload &&
      typeof payload === "object" &&
      "error" in payload &&
      typeof payload.error === "string"
        ? payload.error
        : `Gentic API request failed with ${response.status}`
    throw new Error(message)
  }

  writeConfigFile({ GENTIC_HOST_SETUP_STATE: "ready" })
}

function toolCapability(status: ToolStatuses["claude"]) {
  return {
    enabled: true,
    available: status?.installed ?? false,
    authenticated: status?.authenticated ?? null,
    version: status?.version ?? null,
    models: [],
    metadata: {},
  }
}
