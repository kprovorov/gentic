import { deleteHost, renameHost } from "@gentic/services/hosts"
import { renameHostInputSchema } from "@gentic/validators/hosts"

import { hostMutationRoute } from "../_lib"

export const runtime = "nodejs"

export const PATCH = hostMutationRoute(async ({ context, params, request }) => {
  const id = params.id
  if (!id) {
    throw new Error("Missing host id")
  }

  const input = renameHostInputSchema.parse(await request.json())
  const host = await renameHost(context.supabase, context.userId, id, input)

  return { host }
})

export const DELETE = hostMutationRoute(
  async ({ context, params, request }) => {
    const id = params.id
    if (!id) {
      throw new Error("Missing host id")
    }

    await request.json().catch(() => ({}))
    await deleteHost(context.supabase, context.userId, id)

    return { ok: true }
  }
)
