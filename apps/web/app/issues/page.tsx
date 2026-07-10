import type { Metadata } from "next"

import { getIssuesData } from "@/app/queries"

import { IssuesView } from "./issues-view"

export const metadata: Metadata = {
  title: "Issues",
  description: "Track agent work, blockers, and recent project activity.",
}

export default async function IssuesPage() {
  const initialData = await getIssuesData()

  return <IssuesView initialData={initialData} />
}
