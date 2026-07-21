import { notFound } from "next/navigation"

import { getIssueDetailData, QueryNotFoundError } from "@/app/queries"

import { IssueDetailView } from "./issue-detail-view"

export default async function IssueDetailPage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const { id } = await params
  const data = await getIssueDetailData(id).catch((error: unknown) => {
    if (error instanceof QueryNotFoundError) {
      notFound()
    }
    throw error
  })

  return <IssueDetailView data={data} />
}
