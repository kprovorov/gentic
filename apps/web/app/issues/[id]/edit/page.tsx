import { notFound } from "next/navigation"

import { getIssueEditData, QueryNotFoundError } from "@/app/queries"

import { EditIssueView } from "./edit-issue-view"

export default async function EditIssuePage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const { id } = await params
  const initialData = await getIssueEditData(id).catch((error: unknown) => {
    if (error instanceof QueryNotFoundError) {
      notFound()
    }
    throw error
  })

  return <EditIssueView issueId={id} initialData={initialData} />
}
