import type { Metadata } from "next"

import { getNewIssueData } from "@/app/queries"

import { HomeView } from "./home-view"

export const metadata: Metadata = {
  title: "Home",
}

export default async function HomePage() {
  const initialData = await getNewIssueData()

  return <HomeView initialData={initialData} />
}
