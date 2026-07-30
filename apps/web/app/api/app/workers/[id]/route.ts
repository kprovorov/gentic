import { deleteWorker, renameWorker } from "@gentic/services/workers"
import { renameWorkerInputSchema } from "@gentic/validators/workers"

import { workerMutationRoute } from "../_lib"

export const runtime = "nodejs"

export const PATCH = workerMutationRoute(
  async ({ context, params, request }) => {
    const id = params.id
    if (!id) {
      throw new Error("Missing worker id")
    }

    const input = renameWorkerInputSchema.parse(await request.json())
    const worker = await renameWorker(
      context.supabase,
      context.userId,
      id,
      input
    )

    return { worker }
  }
)

export const DELETE = workerMutationRoute(
  async ({ context, params, request }) => {
    const id = params.id
    if (!id) {
      throw new Error("Missing worker id")
    }

    await request.json().catch(() => ({}))
    await deleteWorker(context.supabase, context.userId, id)

    return { ok: true }
  }
)
