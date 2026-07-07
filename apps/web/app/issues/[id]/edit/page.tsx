import { getIssueEditData } from "@/app/queries"

import { EditIssueView } from "./edit-issue-view"

export default async function EditIssuePage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const { id } = await params
  const initialData = await getIssueEditData(id)

  return <EditIssueView issueId={id} initialData={initialData} />
}
