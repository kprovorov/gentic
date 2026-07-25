import { notFound, redirect } from "next/navigation"
import { slugifyIssueTitle } from "@gentic/services/issues"

import { getIssueDetailData, QueryNotFoundError } from "@/app/queries"
import { getIssueHref, parseIssueCode } from "@/app/issues/urls"

import { IssueDetailView } from "../issue-detail-view"

export default async function IssueDetailPage({
  params,
}: {
  params: Promise<{ code: string; slug?: string[] }>
}) {
  const { code, slug } = await params
  const issueCode = parseIssueCode(code)

  if (!issueCode) {
    notFound()
  }

  const data = await getIssueDetailData(
    issueCode.projectKey,
    issueCode.issueNumber
  ).catch((error: unknown) => {
    if (error instanceof QueryNotFoundError) {
      notFound()
    }
    throw error
  })

  const requestedSlug = slug?.join("/") ?? null
  const currentSlug = slugifyIssueTitle(data.issue.title)

  if (!currentSlug && !requestedSlug) {
    return <IssueDetailView data={data} />
  }

  if (requestedSlug !== currentSlug) {
    const canonicalHref = getIssueHref(data.issue)
    if (!canonicalHref) {
      notFound()
    }
    redirect(canonicalHref)
  }

  return <IssueDetailView data={data} />
}
