import type { ProjectValues } from "@gentic/validators/projects"

import { ServiceError } from "./errors"
import type { Supabase } from "./types"

export async function listProjects(supabase: Supabase, userId: string) {
  const { data, error } = await supabase
    .from("projects")
    .select("*")
    .eq("user_id", userId)
    .order("created_at", { ascending: false })

  if (error) {
    throw new ServiceError("internal", error.message)
  }

  return data
}

export async function getProject(supabase: Supabase, userId: string, id: string) {
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
  const { data, error } = await supabase
    .from("projects")
    .insert({ ...input, user_id: userId })
    .select("*")
    .single()

  if (error) {
    throw new ServiceError("internal", error.message)
  }

  return data
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

export async function deleteProject(supabase: Supabase, userId: string, id: string) {
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
