import { getConfigInput } from "./config.js"
import { writeConfigFile } from "./config-store.js"
import { cancel, isCancel, log, password, text } from "./ui.js"

export const DEFAULT_API_URL = "https://gentic.chat/api/v1"

export interface AuthLoginPromptResult {
  cancelled: boolean
  apiUrl?: string
  apiKeyConfigured: boolean
}

// The Gentic API currently has no read-only authenticated endpoint: the only
// agent route that doesn't require an existing issue id is POST
// /agent/issues/claim, which has side effects (it claims an issue), so it
// can't be used as a "does this key work" probe. Adding a dedicated
// health-check endpoint is out of scope here, so we skip live validation and
// say so clearly instead of pretending to have checked.
export function unvalidatedKeyNotice(): string {
  return "No read-only Gentic API endpoint is available to validate credentials against yet; saved without validation and will fail on first poll if incorrect."
}

function maskApiKey(apiKey: string): string {
  const suffix = apiKey.slice(-4)
  return `${apiKey.slice(0, 3)}...${suffix}`
}

export async function runAuthLoginPrompt(): Promise<AuthLoginPromptResult> {
  const existing = getConfigInput()
  let apiUrl = existing.GENTIC_API_URL
  let apiKeyConfigured = Boolean(existing.GENTIC_API_KEY)

  if (apiUrl === undefined) {
    const answer = await text({
      message: "Gentic API URL",
      defaultValue: DEFAULT_API_URL,
      placeholder: DEFAULT_API_URL,
    })
    if (isCancel(answer)) {
      cancel("Cancelled.")
      return { cancelled: true, apiKeyConfigured }
    }
    apiUrl = answer || DEFAULT_API_URL
  } else {
    log.info(`Gentic API URL already configured: ${apiUrl}`)
  }

  if (!apiKeyConfigured) {
    const apiKey = await password({
      message: "Gentic API key",
      validate: (value) =>
        !value || value.length === 0 ? "API key is required" : undefined,
    })
    if (isCancel(apiKey)) {
      cancel("Cancelled.")
      return { cancelled: true, apiUrl, apiKeyConfigured }
    }

    log.warn(unvalidatedKeyNotice())

    writeConfigFile({
      GENTIC_API_KEY: apiKey,
      GENTIC_API_URL: apiUrl,
    })
    apiKeyConfigured = true
  } else {
    log.info(
      `Gentic API key already configured: ${maskApiKey(existing.GENTIC_API_KEY ?? "")}`
    )
  }

  return { cancelled: false, apiUrl, apiKeyConfigured }
}
