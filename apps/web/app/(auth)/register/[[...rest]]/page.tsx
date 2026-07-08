import type { Metadata } from "next"
import { redirect } from "next/navigation"
import { auth } from "@clerk/nextjs/server"
import { SignUp } from "@clerk/nextjs"

export const metadata: Metadata = {
  title: "Create account",
}

export default async function RegisterPage() {
  const { userId } = await auth()

  if (userId) {
    redirect("/")
  }

  return <SignUp path="/register" signInUrl="/login" />
}
