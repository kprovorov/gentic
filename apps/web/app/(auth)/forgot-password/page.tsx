import type { Metadata } from "next"
import { redirect } from "next/navigation"

import { createClient } from "@gentic/supabase/server"
import { ForgotPasswordForm } from "@/components/auth/forgot-password-form"

export const metadata: Metadata = {
  title: "Reset password",
}

export default async function ForgotPasswordPage() {
  const supabase = await createClient()
  const { data } = await supabase.auth.getClaims()

  if (data?.claims) {
    redirect("/")
  }

  return <ForgotPasswordForm />
}
