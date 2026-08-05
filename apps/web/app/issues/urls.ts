import {
  getIssueCode,
  parseIssueCode,
  slugifyIssueTitle,
} from "@gentic/services/issues"

export { parseIssueCode }

export type IssueUrlParts = {
  number: number
  title: string | null
  projects: {
    key: string
  } | null
}

export function getIssueHref(issue: IssueUrlParts) {
  if (!issue.projects) return null

  const code = getIssueCode(issue.projects.key, issue.number)
  const slug = slugifyIssueTitle(issue.title)

  return slug ? `/issues/${code}/${slug}` : `/issues/${code}`
}

export function getIssueEditHref(issue: IssueUrlParts) {
  if (!issue.projects) return null

  return `/issues/${getIssueCode(issue.projects.key, issue.number)}/edit`
}
