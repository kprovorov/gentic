import { getIssueHref, type IssueUrlParts } from "@/app/issues/urls"

export function getSyncedIssueHref(
  issue: IssueUrlParts,
  currentPathname: string
) {
  const nextHref = getIssueHref(issue)
  if (!nextHref || currentPathname === nextHref) {
    return null
  }

  return nextHref
}
