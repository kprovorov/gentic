import type { Metadata } from "next"

import { getHomeData } from "@/app/queries"

import { HomeView } from "./home-view"

export const metadata: Metadata = {
  title: "Home",
}

export default async function HomePage() {
  const initialData = await getHomeData()

  return <HomeView initialData={initialData} />
}
