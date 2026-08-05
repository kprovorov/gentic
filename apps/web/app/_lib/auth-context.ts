import { redirect } from "next/navigation"
import { auth } from "@clerk/nextjs/server"

import { createClient } from "@gentic/supabase/server"
import { createServiceClient } from "@gentic/supabase/service"

export async function getOptionalAuthenticatedContext() {
  const { userId } = await auth()

  if (!userId) {
    return null
  }

  return { supabase: await createClient(), userId }
}

// For routes that call SECURITY DEFINER RPCs (worker lifecycle management)
// which are granted to service_role only and enforce ownership themselves
// via a p_user_id check, rather than relying on table RLS.
export async function getOptionalAuthenticatedServiceContext() {
  const { userId } = await auth()

  if (!userId) {
    return null
  }

  return { supabase: createServiceClient(), userId }
}

export async function getAuthenticatedContext() {
  const context = await getOptionalAuthenticatedContext()

  if (!context) {
    redirect("/login")
  }

  return context
}

// Redirect-wrapped counterpart to getOptionalAuthenticatedServiceContext,
// for Server Actions that call SECURITY DEFINER RPCs the same way the
// worker mutation API routes do.
export async function getAuthenticatedServiceContext() {
  const context = await getOptionalAuthenticatedServiceContext()

  if (!context) {
    redirect("/login")
  }

  return context
}
