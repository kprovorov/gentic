import type { Metadata } from "next"
import { redirect } from "next/navigation"
import { auth } from "@clerk/nextjs/server"
import { SignIn } from "@clerk/nextjs"

export const metadata: Metadata = {
  title: "Log in",
}

export default async function LoginPage() {
  const { userId } = await auth()

  if (userId) {
    redirect("/")
  }

  return <SignIn path="/login" signUpUrl="/register" />
}
