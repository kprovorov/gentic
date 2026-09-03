import { banHost } from "@gentic/services/hosts"
import { hostLifecycleOperationInputSchema } from "@gentic/validators/hosts"

import { hostMutationRoute } from "../../_lib"

export const runtime = "nodejs"

export const POST = hostMutationRoute(async ({ context, params, request }) => {
  const id = params.id
  if (!id) {
    throw new Error("Missing host id")
  }

  hostLifecycleOperationInputSchema.parse(
    await request.json().catch(() => ({}))
  )
  const host = await banHost(context.supabase, context.userId, id)

  return { host }
})
