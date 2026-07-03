import type { Metadata } from "next"
import { redirect } from "next/navigation"
import { auth } from "@clerk/nextjs/server"

import { ForgotPasswordForm } from "@/components/auth/forgot-password-form"

export const metadata: Metadata = {
  title: "Reset password",
}

export default async function ForgotPasswordPage() {
  const { userId } = await auth()

  if (userId) {
    redirect("/")
  }

  return <ForgotPasswordForm />
}
