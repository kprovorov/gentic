import { redirect } from "next/navigation"

import { createClient } from "@/lib/supabase/server"
import { LoginForm } from "@/components/auth/login-form"

export default async function LoginPage() {
  const supabase = await createClient()
  const { data } = await supabase.auth.getClaims()

  if (data?.claims) {
    redirect("/")
  }

  return <LoginForm />
}
