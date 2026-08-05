import * as githubIntegrationsService from "@gentic/services/github-integrations"
import * as issuesService from "@gentic/services/issues"
import type { Supabase } from "@gentic/services/types"

import { fetchPullRequestState } from "@/lib/github-app"

export function parsePullNumber(prUrl: string): number | null {
  const match = prUrl.match(/\/pull\/(\d+)/)
  return match ? Number(match[1]) : null
}

// Resolves a freshly attached PR's pill state live from the owner's GitHub App
// installation and caches it on `issue_pull_requests.state`. Called once, right
// after the worker first opens the PR, so the pill shows a real status instead
// of "status unavailable" while waiting for the first `pull_request` webhook to
// arrive (the webhook keeps it live afterward). Best-effort: any failure — no
// installation, unparseable URL, GitHub error, or a state the cache column
// can't store (`unknown`) — leaves the row's NULL state as-is.
export async function backfillAttachedPullRequestState(
  supabase: Supabase,
  userId: string,
  repo: string | null | undefined,
  prUrl: string
): Promise<void> {
  const pullNumber = parsePullNumber(prUrl)
  const [owner, name] = (repo ?? "").split("/")
  if (!pullNumber || !owner || !name) {
    return
  }

  try {
    const integration = await githubIntegrationsService.getGithubIntegration(
      supabase,
      userId
    )
    if (!integration?.installation_id) {
      return
    }

    const state = await fetchPullRequestState(
      integration.installation_id,
      owner,
      name,
      pullNumber
    )
    if (state === "unknown") {
      return
    }

    await issuesService.updatePullRequestStateByPrUrl(supabase, prUrl, state)
  } catch (error) {
    console.error(
      "[pull-request-state] failed to backfill attached PR state:",
      error
    )
  }
}
