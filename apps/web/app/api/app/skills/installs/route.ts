import {
  createHostSkillInstalls,
  listHostSkillInstalls,
} from "@gentic/services/skills"

import { skillsRoute } from "../_lib"

export const runtime = "nodejs"

const MAX_POLLED_INSTALLS = 64

export function createSkillInstallsRoute(
  deps: {
    createInstalls?: typeof createHostSkillInstalls
  } & Parameters<typeof skillsRoute>[1] = {}
) {
  return skillsRoute(
    async ({ context, request }) =>
      (deps.createInstalls ?? createHostSkillInstalls)(
        context.supabase,
        context.userId,
        await request.json()
      ),
    deps
  )
}

export function createSkillInstallsPollRoute(
  deps: {
    listInstalls?: typeof listHostSkillInstalls
  } & Parameters<typeof skillsRoute>[1] = {}
) {
  return skillsRoute(async ({ context, request }) => {
    const ids = (new URL(request.url).searchParams.get("ids") ?? "")
      .split(",")
      .map((id) => id.trim())
      .filter(Boolean)
      .slice(0, MAX_POLLED_INSTALLS)

    return {
      installs: await (deps.listInstalls ?? listHostSkillInstalls)(
        context.supabase,
        context.userId,
        ids
      ),
    }
  }, deps)
}

export const POST = createSkillInstallsRoute()
export const GET = createSkillInstallsPollRoute()
