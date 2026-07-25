import { getIssueCode, slugifyIssueTitle } from "@gentic/services/issues"

export type IssueUrlParts = {
  number: number
  title: string | null
  projects: {
    key: string
  } | null
}

export function parseIssueCode(code: string) {
  const match = /^([A-Z][A-Z0-9]*)-(\d+)$/.exec(code.toUpperCase())
  if (!match) return null

  const issueNumber = Number.parseInt(match[2], 10)
  if (!Number.isSafeInteger(issueNumber) || issueNumber < 1) return null

  return {
    projectKey: match[1],
    issueNumber,
  }
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
