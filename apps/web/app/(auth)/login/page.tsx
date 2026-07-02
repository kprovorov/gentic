import type { Metadata } from "next"
import { redirect } from "next/navigation"

import { createClient } from "@gentic/supabase/server"
import { LoginForm } from "@/components/auth/login-form"

export const metadata: Metadata = {
  title: "Log in",
}

export default async function LoginPage() {
  const supabase = await createClient()
  const { data } = await supabase.auth.getClaims()

  if (data?.claims) {
    redirect("/")
  }

  return <LoginForm />
}
