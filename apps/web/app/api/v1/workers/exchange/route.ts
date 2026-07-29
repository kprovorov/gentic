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
        worker: {
          id: result.worker.id,
          display_name: result.worker.display_name,
          setup_state: result.worker.setup_state,
        },
        credential: result.credential,
      })
    } catch {
      return Response.json({ error: "Invalid enrollment code" }, { status: 400 })
    }
  }
}

export function rateLimitKeyFromRequest(request: Request): string {
  const forwardedFor = request.headers.get("x-forwarded-for") ?? ""
  const realIp = request.headers.get("x-real-ip") ?? ""
  const userAgent = request.headers.get("user-agent") ?? ""
  const subject = forwardedFor.split(",")[0]?.trim() || realIp || "unknown"

  return `${subject}:${userAgent}`
}
