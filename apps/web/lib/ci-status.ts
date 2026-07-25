import * as githubIntegrationsService from "@gentic/services/github-integrations"
import type { Supabase } from "@gentic/services/types"
import type { IssueStatus } from "@gentic/validators/issues"

import {
  fetchCheckSuitesForRef,
  fetchPullRequestHeadSha,
  type GithubCheckSuite,
} from "@/lib/github-app"

// Conclusions that mean the check suite did not pass. `neutral` and `skipped`
// are treated as passing since they don't represent a broken build.
const FAILURE_CONCLUSIONS = new Set([
  "failure",
  "timed_out",
  "action_required",
  "cancelled",
  "stale",
  "startup_failure",
])

export function checkSuitesFailed(suites: GithubCheckSuite[]): boolean {
  return suites.some(
    (suite) => suite.conclusion && FAILURE_CONCLUSIONS.has(suite.conclusion)
  )
}

export function resolveCheckSuiteStatus(
  suites: GithubCheckSuite[]
): IssueStatus {
  if (suites.length === 0) {
    return "ready-for-review"
  }

  if (suites.some((suite) => suite.status !== "completed")) {
    return "testing"
  }

  return checkSuitesFailed(suites) ? "tests-failed" : "ready-for-review"
}

export type PrFinishState = {
  status: IssueStatus
  headSha: string | null
}

function parsePullNumber(prUrl: string): number | null {
  const match = prUrl.match(/\/pull\/(\d+)/)
  return match ? Number(match[1]) : null
}

// Called right after the worker reports a freshly opened/updated PR. If the
// repo has CI check suites configured for the PR's head commit, the issue
// should wait in `testing` for the github webhook (`check_suite` completed)
// to resolve it to `ready-for-review` / `tests-failed` instead of jumping
// straight to `ready-for-review`. Any lookup failure (no integration, no
// installation, GitHub API error) falls back to the original `ready-for-review`
// behavior rather than blocking the run from finishing.
export async function resolvePrFinishStatus(
  supabase: Supabase,
  userId: string,
  repo: string,
  prUrl: string
): Promise<IssueStatus> {
  return (await resolvePrFinishState(supabase, userId, repo, prUrl)).status
}

export async function resolvePrFinishState(
  supabase: Supabase,
  userId: string,
  repo: string,
  prUrl: string
): Promise<PrFinishState> {
  const pullNumber = parsePullNumber(prUrl)
  const [owner, name] = repo.split("/")

  if (!pullNumber || !owner || !name) {
    return { status: "ready-for-review", headSha: null }
  }

  try {
    const integration = await githubIntegrationsService.getGithubIntegration(
      supabase,
      userId
    )

    if (!integration?.installation_id) {
      return { status: "ready-for-review", headSha: null }
    }

    const headSha = await fetchPullRequestHeadSha(
      integration.installation_id,
      owner,
      name,
      pullNumber
    )

    try {
      const suites = await fetchCheckSuitesForRef(
        integration.installation_id,
        owner,
        name,
        headSha
      )

      return { status: resolveCheckSuiteStatus(suites), headSha }
    } catch (error) {
      console.error(
        "[ci-status] failed to check CI suites, defaulting to ready-for-review:",
        error
      )
      return { status: "ready-for-review", headSha }
    }
  } catch (error) {
    console.error(
      "[ci-status] failed to check PR head SHA, defaulting to ready-for-review:",
      error
    )
    return { status: "ready-for-review", headSha: null }
  }
}
