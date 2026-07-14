import { redirect } from "next/navigation"
import { auth } from "@clerk/nextjs/server"

import { createClient } from "@gentic/supabase/server"

export async function getOptionalAuthenticatedContext() {
  const { userId } = await auth()

  if (!userId) {
    return null
  }

  return { supabase: await createClient(), userId }
}

export async function getAuthenticatedContext() {
  const context = await getOptionalAuthenticatedContext()

  if (!context) {
    redirect("/login")
  }

  return context
}
