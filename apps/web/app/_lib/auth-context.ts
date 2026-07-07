import { redirect } from "next/navigation"
import { auth } from "@clerk/nextjs/server"

import { createClient } from "@gentic/supabase/server"

export async function getAuthenticatedContext() {
  const { userId } = await auth()

  if (!userId) {
    redirect("/login")
  }

  return { supabase: await createClient(), userId }
}
