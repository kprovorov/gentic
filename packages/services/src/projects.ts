import type { ProjectValues } from "@gentic/validators/projects"

import { ServiceError, unwrap } from "./errors"
import type { Supabase } from "./types"

/**
 * First word of the name, uppercased letters only, truncated/padded to 3
 * characters (falls back to "PRJ" if the first word has no letters at all).
 * Must stay in lockstep with the backfill logic in
 * supabase/migrations/20260725120000_add_project_key.sql.
 */
function deriveProjectKeyBase(name: string): string {
  const firstWord = name.trim().split(/\s+/)[0] ?? ""
  const letters = firstWord.toUpperCase().replace(/[^A-Z]/g, "")

  if (letters.length === 0) {
    return "PRJ"
  }
  if (letters.length >= 3) {
    return letters.slice(0, 3)
  }
  return letters.padEnd(3, letters[letters.length - 1])
}

async function generateProjectKey(
  supabase: Supabase,
  userId: string,
  name: string
): Promise<string> {
  const base = deriveProjectKeyBase(name)

  for (let suffix = 0; ; suffix++) {
    const candidate = suffix === 0 ? base : `${base}${suffix + 1}`

    const { data, error } = await supabase
      .from("projects")
      .select("id")
      .eq("user_id", userId)
      .eq("key", candidate)
      .maybeSingle()

    if (error) {
      throw new ServiceError("internal", error.message)
    }
    if (!data) {
      return candidate
    }
  }
}

export async function listProjects(supabase: Supabase, userId: string) {
  return unwrap(
    await supabase
      .from("projects")
      .select("*")
      .eq("user_id", userId)
      .order("created_at", { ascending: false })
  )
}

export async function getProject(
  supabase: Supabase,
  userId: string,
  id: string
) {
  const { data, error } = await supabase
    .from("projects")
    .select("*")
    .eq("id", id)
    .eq("user_id", userId)
    .maybeSingle()

  if (error) {
    throw new ServiceError("internal", error.message)
  }
  if (!data) {
    throw new ServiceError("not_found", "Project not found")
  }

  return data
}

export async function createProject(
  supabase: Supabase,
  userId: string,
  input: ProjectValues
) {
  const key = await generateProjectKey(supabase, userId, input.name)

  const result = await supabase
    .from("projects")
    .insert({ ...input, user_id: userId, key })
    .select("*")
    .single()

  return unwrap(result)
}

export async function updateProject(
  supabase: Supabase,
  userId: string,
  id: string,
  input: ProjectValues
) {
  const { data, error } = await supabase
    .from("projects")
    .update({ ...input, updated_at: new Date().toISOString() })
    .eq("id", id)
    .eq("user_id", userId)
    .select("*")
    .maybeSingle()

  if (error) {
    throw new ServiceError("internal", error.message)
  }
  if (!data) {
    throw new ServiceError("not_found", "Project not found")
  }

  return data
}

export async function deleteProject(
  supabase: Supabase,
  userId: string,
  id: string
) {
  const { data, error } = await supabase
    .from("projects")
    .delete()
    .eq("id", id)
    .eq("user_id", userId)
    .select("id")
    .maybeSingle()

  if (error) {
    throw new ServiceError("internal", error.message)
  }
  if (!data) {
    throw new ServiceError("not_found", "Project not found")
  }
}
