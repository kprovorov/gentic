import { ServiceError } from "@gentic/services/errors"
import { exchangeWorkerEnrollmentCode } from "@gentic/services/workers"
import { createServiceClient } from "@gentic/supabase/service"

export const runtime = "nodejs"

export const POST = createWorkerExchangeHandler({
  createSupabase: createServiceClient,
  exchange: exchangeWorkerEnrollmentCode,
})

export function createWorkerExchangeHandler(deps: {
  createSupabase: typeof createServiceClient
  exchange: typeof exchangeWorkerEnrollmentCode
}) {
  return async function POST(request: Request) {
    try {
      const body = await request.json()
      const result = await deps.exchange(deps.createSupabase(), body, {
        rateLimitKey: rateLimitKeyFromRequest(request),
      })

      return Response.json({
        api_url: apiUrlFromRequest(request),
        worker: {
          id: result.worker.id,
          display_name: result.worker.display_name,
          setup_state: result.worker.setup_state,
        },
        credential: result.credential,
      })
    } catch (error) {
      const status =
        error instanceof ServiceError && error.code === "rate_limited"
          ? 429
          : 400
      return Response.json({ error: "Invalid enrollment code" }, { status })
    }
  }
}

function apiUrlFromRequest(request: Request): string {
  const url = new URL(request.url)
  url.pathname = "/api/v1"
  url.search = ""
  return url.toString().replace(/\/$/, "")
}

export function rateLimitKeyFromRequest(request: Request): string {
  const vercelForwardedFor =
    request.headers.get("x-vercel-forwarded-for") ?? ""
  const forwardedFor = request.headers.get("x-forwarded-for") ?? ""
  const subject =
    firstForwardedFor(vercelForwardedFor) ??
    rightMostForwardedFor(forwardedFor) ??
    "unknown"

  return subject
}

function firstForwardedFor(value: string): string | null {
  return value
    .split(",")
    .map((part) => part.trim())
    .find(Boolean) ?? null
}

function rightMostForwardedFor(value: string): string | null {
  return value
    .split(",")
    .map((part) => part.trim())
    .filter(Boolean)
    .at(-1) ?? null
}
