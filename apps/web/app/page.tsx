import type { Metadata } from "next"
import { redirect } from "next/navigation"
import { auth } from "@clerk/nextjs/server"

export const metadata: Metadata = {
  title: "Gentic",
}

export default async function Page() {
  const { userId } = await auth()

  if (userId) {
    redirect("/home")
  }

  return (
    <main className="flex min-h-svh items-center justify-center p-6">
      <h1 className="text-4xl font-semibold tracking-normal">Gentic</h1>
    </main>
  )
}
