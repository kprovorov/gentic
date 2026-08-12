import { parseSkillUrl, resolveSkillAuditGate } from "@gentic/services/skills"

import { skillsRoute } from "../_lib"

export const runtime = "nodejs"

export function createSkillAuditRoute(
  deps: {
    parseUrl?: typeof parseSkillUrl
    resolveGate?: typeof resolveSkillAuditGate
  } & Parameters<typeof skillsRoute>[1] = {}
) {
  return skillsRoute(async ({ request }) => {
    const url = new URL(request.url).searchParams.get("url") ?? ""
    const skill = (deps.parseUrl ?? parseSkillUrl)(url)
    const gate = await (deps.resolveGate ?? resolveSkillAuditGate)(skill)

    return { skill, gate }
  }, deps)
}

export const GET = createSkillAuditRoute()
