import type { Metadata } from "next"
import { redirect } from "next/navigation"

import { createClient } from "@gentic/supabase/server"
import { ResetPasswordForm } from "@/components/auth/reset-password-form"

export const metadata: Metadata = {
  title: "Set a new password",
}

export default async function ResetPasswordPage() {
  const supabase = await createClient()
  const { data } = await supabase.auth.getClaims()

  // The recovery link exchanged in /auth/confirm establishes a session
  // before landing here. Without one, there's no password to reset.
  if (!data?.claims) {
    redirect("/login?error=invalid_link")
  }

  return <ResetPasswordForm />
}
