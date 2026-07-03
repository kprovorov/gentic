import type { Metadata } from "next"
import { redirect } from "next/navigation"
import { auth } from "@clerk/nextjs/server"

import { LoginForm } from "@/components/auth/login-form"

export const metadata: Metadata = {
  title: "Log in",
}

export default async function LoginPage() {
  const { userId } = await auth()

  if (userId) {
    redirect("/")
  }

  return <LoginForm />
}
