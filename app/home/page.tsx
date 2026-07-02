import type { Metadata } from "next"
import { redirect } from "next/navigation"

import { createClient } from "@/lib/supabase/server"

export const metadata: Metadata = {
  title: "Home",
}

export default async function HomePage() {
  const supabase = await createClient()
  const { data } = await supabase.auth.getClaims()

  const claims = data?.claims

  if (!claims) {
    redirect("/login")
  }

  const metadata = (claims.user_metadata ?? {}) as Record<string, unknown>
  const name =
    (typeof metadata.name === "string" && metadata.name) ||
    (typeof metadata.full_name === "string" && metadata.full_name) ||
    (typeof claims.email === "string" && claims.email) ||
    "there"

  return (
    <div className="flex min-h-svh items-center justify-center p-6">
      <h1>Hello {name}!</h1>
    </div>
  )
}
