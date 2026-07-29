import { arch, hostname, platform } from "node:os"

import { workerCredentialSchema } from "@gentic/validators/workers"
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
    worker: z
      .object({
        id: z.string().min(1),
        display_name: z.string().min(1).optional(),
        setup_state: z.string().optional(),
      }),
    credential: workerCredentialSchema,
  })

export interface WorkerEnrollment {
  apiUrl: string
  workerId: string
  workerCredential: string
  displayName?: string
}

export interface ConnectWorkerDeps {
  fetch?: typeof fetch
  getTools?: () => Promise<ToolStatuses>
  hostname?: () => string
  now?: () => Date
}

export function suggestedWorkerName(
  getHostname: () => string = hostname
): string {
  const name = getHostname().trim()
  return name.length > 0 ? name : "Gentic Worker"
}

export async function connectWorkerWithCode(
  code: string,
  options: {
    apiUrl?: string
    configuredCapacity?: number
  } = {},
  deps: ConnectWorkerDeps = {}
): Promise<WorkerEnrollment> {
  const apiUrl = (options.apiUrl ?? DEFAULT_API_URL).replace(/\/+$/, "")
  const getTools = deps.getTools ?? getToolStatuses
  const tools = await getTools()
  const response = await (deps.fetch ?? fetch)(
    `${apiUrl}/workers/exchange`,
    {
      method: "POST",
      headers: {
        "content-type": "application/json",
      },
      body: JSON.stringify({
        code,
        display_name: suggestedWorkerName(deps.hostname),
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
    throw new Error(`Invalid or expired worker connection code.${retrySuffix}`)
  }

  const parsed = exchangeResponseSchema.parse(payload)
  const enrollment = {
    apiUrl: (parsed.api_url ?? apiUrl).replace(/\/+$/, ""),
    workerId: parsed.worker.id,
    workerCredential: parsed.credential,
    displayName: parsed.worker.display_name,
  }

  writeConfigFile({
    GENTIC_API_URL: enrollment.apiUrl,
    GENTIC_WORKER_ID: enrollment.workerId,
    GENTIC_WORKER_CREDENTIAL: enrollment.workerCredential,
    GENTIC_WORKER_SETUP_STATE: "setup-incomplete",
  })

  return enrollment
}

export async function markWorkerSetupReady(
  deps: {
    fetch?: typeof fetch
  } = {}
): Promise<void> {
  const config = getConfigInput()
  const apiUrl = config.GENTIC_API_URL
  const workerCredential = config.GENTIC_WORKER_CREDENTIAL
  const workerId = config.GENTIC_WORKER_ID
  const missing = [
    apiUrl ? null : "GENTIC_API_URL",
    workerCredential ? null : "GENTIC_WORKER_CREDENTIAL",
    workerId ? null : "GENTIC_WORKER_ID",
  ].filter((key): key is string => key !== null)
  if (!apiUrl || !workerCredential || !workerId) {
    logError(
      `cannot mark worker setup ready: missing ${missing.join(" and ")}`
    )
    return
  }

  const response = await (deps.fetch ?? fetch)(
    `${apiUrl.replace(/\/+$/, "")}/agent/worker/setup`,
    {
      method: "PATCH",
      headers: {
        authorization: `Bearer ${workerCredential}`,
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

  writeConfigFile({ GENTIC_WORKER_SETUP_STATE: "ready" })
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
