import { getIssueDetailData } from "@/app/queries"

import { IssueDetailView } from "./issue-detail-view"

export default async function IssueDetailPage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const { id } = await params
  const initialData = await getIssueDetailData(id)

  return <IssueDetailView issueId={id} initialData={initialData} />
}
