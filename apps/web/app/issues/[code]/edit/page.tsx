import { notFound } from "next/navigation"

import { getIssueEditDataByCode, QueryNotFoundError } from "@/app/queries"
import { parseIssueCode } from "@/app/issues/urls"

import { EditIssueView } from "./edit-issue-view"

export default async function EditIssuePage({
  params,
}: {
  params: Promise<{ code: string }>
}) {
  const { code } = await params
  const issueCode = parseIssueCode(code)

  if (!issueCode) {
    notFound()
  }

  const initialData = await getIssueEditDataByCode(
    issueCode.projectKey,
    issueCode.issueNumber
  ).catch((error: unknown) => {
    if (error instanceof QueryNotFoundError) {
      notFound()
    }
    throw error
  })

  return <EditIssueView issueId={initialData.id} initialData={initialData} />
}
