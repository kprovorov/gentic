import { listSkillInstallTargets } from "@gentic/services/skills"

import { skillsRoute } from "../_lib"

export const runtime = "nodejs"

export function createSkillInstallTargetsRoute(
  deps: {
    listTargets?: typeof listSkillInstallTargets
  } & Parameters<typeof skillsRoute>[1] = {}
) {
  return skillsRoute(
    async ({ context }) => ({
      hosts: await (deps.listTargets ?? listSkillInstallTargets)(
        context.supabase,
        context.userId
      ),
    }),
    deps
  )
}

export const GET = createSkillInstallTargetsRoute()
