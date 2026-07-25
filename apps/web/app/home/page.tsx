import type { Metadata } from "next"
import { redirect } from "next/navigation"

import { getOptionalAuthenticatedContext } from "@/app/_lib/auth-context"
import { getHomeData } from "@/app/queries"

import { HomeView } from "./home-view"

export const metadata: Metadata = {
  title: "Home",
}

export default async function HomePage() {
  const context = await getOptionalAuthenticatedContext()

  if (!context) {
    redirect("/")
  }

  const initialData = await getHomeData(context)

  return <HomeView initialData={initialData} />
}
