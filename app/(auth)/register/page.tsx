import { redirect } from "next/navigation"

import { createClient } from "@/lib/supabase/server"
import { RegisterForm } from "@/components/auth/register-form"

export default async function RegisterPage() {
  const supabase = await createClient()
  const { data } = await supabase.auth.getClaims()

  if (data?.claims) {
    redirect("/")
  }

  return <RegisterForm />
}
