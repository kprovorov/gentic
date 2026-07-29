import { unbanWorker } from "@gentic/services/workers"
import { workerLifecycleOperationInputSchema } from "@gentic/validators/workers"

import { workerMutationRoute } from "../../_lib"

export const runtime = "nodejs"

export const POST = workerMutationRoute(async ({ context, params, request }) => {
  const id = params.id
  if (!id) {
    throw new Error("Missing worker id")
  }

  workerLifecycleOperationInputSchema.parse(
    await request.json().catch(() => ({}))
  )
  const worker = await unbanWorker(context.supabase, context.userId, id)

  return { worker }
})
