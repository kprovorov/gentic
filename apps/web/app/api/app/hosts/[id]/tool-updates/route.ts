import {
  createHostToolUpdate,
  listHostToolUpdates,
} from "@gentic/services/host-tool-updates"
import { createHostToolUpdateInputSchema } from "@gentic/validators/host-tool-updates"

import { hostMutationRoute } from "../../_lib"

export const runtime = "nodejs"

type RouteDeps = {
  createUpdate?: typeof createHostToolUpdate
  listUpdates?: typeof listHostToolUpdates
} & Parameters<typeof hostMutationRoute>[1]

/** Queues one tool update for the host; the service re-checks eligibility. */
export function createHostToolUpdateRoute(deps: RouteDeps = {}) {
  return hostMutationRoute(async ({ context, params, request }) => {
    const id = params.id
    if (!id) {
      throw new Error("Missing host id")
    }

    const input = createHostToolUpdateInputSchema.parse(await request.json())
    const update = await (deps.createUpdate ?? createHostToolUpdate)(
      context.supabase,
      context.userId,
      id,
      input
    )

    return { update }
  }, deps)
}

/** Powers the dialog's poll: every command still on record for the host. */
export function createHostToolUpdatesPollRoute(deps: RouteDeps = {}) {
  return hostMutationRoute(async ({ context, params }) => {
    const id = params.id
    if (!id) {
      throw new Error("Missing host id")
    }

    return {
      updates: await (deps.listUpdates ?? listHostToolUpdates)(
        context.supabase,
        context.userId,
        id
      ),
    }
  }, deps)
}

export const POST = createHostToolUpdateRoute()
export const GET = createHostToolUpdatesPollRoute()
