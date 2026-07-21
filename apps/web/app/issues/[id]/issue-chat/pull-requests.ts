import type { IssuePullRequest } from "@/app/queries"

export function mergePullRequest(
  list: IssuePullRequest[],
  incoming: IssuePullRequest
) {
  if (list.some((pullRequest) => pullRequest.id === incoming.id)) {
    return list.map((pullRequest) =>
      pullRequest.id === incoming.id ? incoming : pullRequest
    )
  }

  return [incoming, ...list].sort((a, b) =>
    b.created_at.localeCompare(a.created_at)
  )
}

export function formatPullRequestLabel(url: string) {
  try {
    const [, owner, repo, , number] = new URL(url).pathname.split("/")
    if (owner && repo && number) {
      return `${owner}/${repo}#${number}`
    }
  } catch {
    // Fall back to a generic label for malformed historical data.
  }

  return "Pull request"
}
