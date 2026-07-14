import { ServiceError, unwrap } from "../errors"
import type { Supabase } from "../types"

export async function ensureProjectOwned(
  supabase: Supabase,
  userId: string,
  projectId: string
) {
  const { data, error } = await supabase
    .from("projects")
    .select("id")
    .eq("id", projectId)
    .eq("user_id", userId)
    .maybeSingle()

  if (error) {
    throw new ServiceError("internal", error.message)
  }
  if (!data) {
    throw new ServiceError("not_found", "Project not found")
  }
}

// The `issues` table has no `user_id` of its own, so ownership is checked via
// a join to `projects`, whose `user_id` column carries the Clerk user id.
export async function ensureIssueOwned(
  supabase: Supabase,
  userId: string,
  issueId: string
) {
  const { data, error } = await supabase
    .from("issues")
    .select("id, projects!inner(user_id)")
    .eq("id", issueId)
    .eq("projects.user_id", userId)
    .maybeSingle()

  if (error) {
    throw new ServiceError("internal", error.message)
  }
  if (!data) {
    throw new ServiceError("not_found", "Issue not found")
  }
}

export async function ensureIssuesOwned(
  supabase: Supabase,
  userId: string,
  issueIds: string[]
) {
  const uniqueIds = Array.from(new Set(issueIds))
  const data = unwrap(
    await supabase
      .from("issues")
      .select("id, projects!inner(user_id)")
      .in("id", uniqueIds)
      .eq("projects.user_id", userId)
  )
  if ((data?.length ?? 0) !== uniqueIds.length) {
    throw new ServiceError("not_found", "Issue not found")
  }
}
