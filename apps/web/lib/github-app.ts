import { createSign } from "node:crypto"

// GitHub caps App JWTs at 10 minutes; stay comfortably under that.
const APP_JWT_TTL_SECONDS = 9 * 60
// Refresh installation tokens a bit before GitHub's own 1-hour expiry.
const TOKEN_REFRESH_SKEW_MS = 60_000

const installationTokenCache = new Map<
  string,
  { token: string; expiresAt: number }
>()

function base64url(input: Buffer | string): string {
  return Buffer.from(input)
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "")
}

function signAppJwt(): string {
  const appId = process.env.GITHUB_APP_ID
  const privateKey = process.env.GITHUB_APP_PRIVATE_KEY

  if (!appId || !privateKey) {
    throw new Error("GITHUB_APP_ID / GITHUB_APP_PRIVATE_KEY are not configured")
  }

  const now = Math.floor(Date.now() / 1000)
  const header = base64url(JSON.stringify({ alg: "RS256", typ: "JWT" }))
  const payload = base64url(
    JSON.stringify({
      iat: now - 60,
      exp: now + APP_JWT_TTL_SECONDS,
      iss: appId,
    })
  )
  const signingInput = `${header}.${payload}`

  const signer = createSign("RSA-SHA256")
  signer.update(signingInput)
  signer.end()

  const signature = base64url(signer.sign(privateKey.replace(/\\n/g, "\n")))

  return `${signingInput}.${signature}`
}

// Installation access tokens are billed/rate-limited by GitHub per mint, so
// cache them in memory per installation until they're close to expiring.
export async function getInstallationToken(
  installationId: string
): Promise<string> {
  const cached = installationTokenCache.get(installationId)
  if (cached && cached.expiresAt - TOKEN_REFRESH_SKEW_MS > Date.now()) {
    return cached.token
  }

  const response = await fetch(
    `https://api.github.com/app/installations/${installationId}/access_tokens`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${signAppJwt()}`,
        Accept: "application/vnd.github+json",
        "X-GitHub-Api-Version": "2022-11-28",
      },
    }
  )

  if (!response.ok) {
    throw new Error(
      `Failed to mint GitHub installation token (${response.status})`
    )
  }

  const data = (await response.json()) as {
    token: string
    expires_at: string
  }

  installationTokenCache.set(installationId, {
    token: data.token,
    expiresAt: new Date(data.expires_at).getTime(),
  })

  return data.token
}

export type GithubReviewComment = {
  path: string
  line: number | null
  diff_hunk: string
  body: string
}

export type GithubInstallationRepository = {
  full_name: string
  private: boolean
}

export async function fetchInstallationRepositories(
  installationId: string
): Promise<GithubInstallationRepository[]> {
  const token = await getInstallationToken(installationId)
  const repositories: GithubInstallationRepository[] = []
  let page = 1

  while (true) {
    const response = await fetch(
      `https://api.github.com/installation/repositories?per_page=100&page=${page}`,
      {
        headers: {
          Authorization: `Bearer ${token}`,
          Accept: "application/vnd.github+json",
          "X-GitHub-Api-Version": "2022-11-28",
        },
      }
    )

    if (!response.ok) {
      throw new Error(
        `Failed to fetch installation repositories (${response.status})`
      )
    }

    const data = (await response.json()) as {
      repositories: {
        full_name: string
        private: boolean
      }[]
    }

    repositories.push(
      ...data.repositories.map((repository) => ({
        full_name: repository.full_name,
        private: repository.private,
      }))
    )

    if (data.repositories.length < 100) {
      break
    }

    page += 1
  }

  return repositories.toSorted((a, b) => a.full_name.localeCompare(b.full_name))
}

export async function fetchPullRequestReviewComments(
  installationId: string,
  owner: string,
  repo: string,
  pullNumber: number,
  reviewId: number
): Promise<GithubReviewComment[]> {
  const token = await getInstallationToken(installationId)

  const response = await fetch(
    `https://api.github.com/repos/${owner}/${repo}/pulls/${pullNumber}/reviews/${reviewId}/comments`,
    {
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: "application/vnd.github+json",
        "X-GitHub-Api-Version": "2022-11-28",
      },
    }
  )

  if (!response.ok) {
    throw new Error(`Failed to fetch review comments (${response.status})`)
  }

  const comments = (await response.json()) as {
    path: string
    line: number | null
    original_line: number | null
    diff_hunk: string
    body: string
  }[]

  return comments.map((comment) => ({
    path: comment.path,
    line: comment.line ?? comment.original_line ?? null,
    diff_hunk: comment.diff_hunk,
    body: comment.body,
  }))
}

export async function fetchPullRequestHeadSha(
  installationId: string,
  owner: string,
  repo: string,
  pullNumber: number
): Promise<string> {
  const token = await getInstallationToken(installationId)

  const response = await fetch(
    `https://api.github.com/repos/${owner}/${repo}/pulls/${pullNumber}`,
    {
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: "application/vnd.github+json",
        "X-GitHub-Api-Version": "2022-11-28",
      },
    }
  )

  if (!response.ok) {
    throw new Error(`Failed to fetch pull request (${response.status})`)
  }

  const data = (await response.json()) as { head: { sha: string } }

  return data.head.sha
}

export type GithubPullRequestState =
  "draft" | "open" | "merged" | "closed" | "queued" | "unknown"

export type GithubPullRequestSnapshot = {
  state: GithubPullRequestState
  headSha: string
  ciState: "unknown" | "pending" | "success" | "failure"
  reviewDecision:
    "unknown" | "review_required" | "approved" | "changes_requested"
}

type RawPullRequestSnapshot = {
  state: "OPEN" | "CLOSED" | "MERGED"
  isDraft: boolean
  headRefOid: string
  reviewDecision: "APPROVED" | "CHANGES_REQUESTED" | "REVIEW_REQUIRED" | null
  statusCheckRollup: {
    state: "EXPECTED" | "ERROR" | "FAILURE" | "PENDING" | "SUCCESS"
  } | null
}

type RawPullRequestState = {
  state: string
  draft?: boolean | null
  merged?: boolean | null
  merged_at?: string | null
  mergeable_state?: string | null
}

export function resolvePullRequestState(
  pullRequest: RawPullRequestState
): GithubPullRequestState {
  if (pullRequest.merged || pullRequest.merged_at) {
    return "merged"
  }
  if (pullRequest.draft) {
    return "draft"
  }
  if (pullRequest.mergeable_state === "queued") {
    return "queued"
  }
  if (pullRequest.state === "open") {
    return "open"
  }
  if (pullRequest.state === "closed") {
    return "closed"
  }

  return "unknown"
}

export async function fetchPullRequestState(
  installationId: string,
  owner: string,
  repo: string,
  pullNumber: number
): Promise<GithubPullRequestState> {
  const token = await getInstallationToken(installationId)

  const response = await fetch(
    `https://api.github.com/repos/${owner}/${repo}/pulls/${pullNumber}`,
    {
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: "application/vnd.github+json",
        "X-GitHub-Api-Version": "2022-11-28",
      },
    }
  )

  if (!response.ok) {
    throw new Error(`Failed to fetch pull request (${response.status})`)
  }

  return resolvePullRequestState((await response.json()) as RawPullRequestState)
}

export async function fetchPullRequestSnapshot(
  installationId: string,
  owner: string,
  repo: string,
  pullNumber: number
): Promise<GithubPullRequestSnapshot> {
  const token = await getInstallationToken(installationId)
  const response = await fetch("https://api.github.com/graphql", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: "application/vnd.github+json",
      "Content-Type": "application/json",
      "X-GitHub-Api-Version": "2022-11-28",
    },
    body: JSON.stringify({
      query: `
        query PullRequestDeliveryState(
          $owner: String!
          $repo: String!
          $number: Int!
        ) {
          repository(owner: $owner, name: $repo) {
            pullRequest(number: $number) {
              state
              isDraft
              headRefOid
              reviewDecision
              statusCheckRollup { state }
            }
          }
        }
      `,
      variables: { owner, repo, number: pullNumber },
    }),
  })

  if (!response.ok) {
    throw new Error(
      `Failed to hydrate pull request delivery state (${response.status})`
    )
  }

  const result = (await response.json()) as {
    data?: {
      repository?: {
        pullRequest?: RawPullRequestSnapshot | null
      } | null
    }
    errors?: { message: string }[]
  }

  const pullRequest = result.data?.repository?.pullRequest
  if (!pullRequest) {
    const detail = result.errors?.map((error) => error.message).join("; ")
    throw new Error(
      `Failed to hydrate pull request delivery state${detail ? `: ${detail}` : ""}`
    )
  }

  return resolvePullRequestSnapshot(pullRequest)
}

export function resolvePullRequestSnapshot(
  pullRequest: RawPullRequestSnapshot
): GithubPullRequestSnapshot {
  const state: GithubPullRequestState = pullRequest.isDraft
    ? "draft"
    : pullRequest.state === "MERGED"
      ? "merged"
      : pullRequest.state === "CLOSED"
        ? "closed"
        : "open"

  const ciState =
    pullRequest.statusCheckRollup?.state === "ERROR" ||
    pullRequest.statusCheckRollup?.state === "FAILURE"
      ? "failure"
      : pullRequest.statusCheckRollup?.state === "EXPECTED" ||
          pullRequest.statusCheckRollup?.state === "PENDING"
        ? "pending"
        : pullRequest.statusCheckRollup?.state === "SUCCESS"
          ? "success"
          : "unknown"

  const reviewDecision =
    pullRequest.reviewDecision === "APPROVED"
      ? "approved"
      : pullRequest.reviewDecision === "CHANGES_REQUESTED"
        ? "changes_requested"
        : pullRequest.reviewDecision === "REVIEW_REQUIRED"
          ? "review_required"
          : "unknown"

  return {
    state,
    headSha: pullRequest.headRefOid,
    ciState,
    reviewDecision,
  }
}

// The check_suite webhook payload's own `pull_requests` array is only
// populated when a PR was already open at the moment the check suite was
// created. The worker pushes commits (which creates the check suite) and
// only opens the PR afterward, so that array comes back empty on every
// delivery. This dedicated endpoint resolves PRs from the commit SHA instead,
// which has no such ordering requirement.
export async function fetchPullRequestNumbersForCommit(
  installationId: string,
  owner: string,
  repo: string,
  sha: string
): Promise<number[]> {
  const token = await getInstallationToken(installationId)

  const response = await fetch(
    `https://api.github.com/repos/${owner}/${repo}/commits/${sha}/pulls`,
    {
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: "application/vnd.github+json",
        "X-GitHub-Api-Version": "2022-11-28",
      },
    }
  )

  if (!response.ok) {
    throw new Error(
      `Failed to fetch pull requests for commit (${response.status})`
    )
  }

  const data = (await response.json()) as { number: number }[]

  return data.map((pullRequest) => pullRequest.number)
}

export type GithubCheckSuite = {
  status: string
  conclusion: string | null
}

type RawCheckSuite = {
  status: string
  conclusion: string | null
  latest_check_runs_count: number
}

// GitHub auto-registers a check suite for every app installed on the account
// that has the `checks` permission (Vercel, Sentry, Netlify, this very Claude
// Code app, etc.), even when that app never runs a check against this repo.
// Those suites sit at `latest_check_runs_count: 0` and status `queued`
// forever, so counting them would mean CI never resolves. Only suites that
// actually reported at least one check run represent real CI signal.
export function isRelevantCheckSuite(suite: RawCheckSuite): boolean {
  return suite.latest_check_runs_count > 0
}

export async function fetchCheckSuitesForRef(
  installationId: string,
  owner: string,
  repo: string,
  ref: string
): Promise<GithubCheckSuite[]> {
  const token = await getInstallationToken(installationId)

  const response = await fetch(
    `https://api.github.com/repos/${owner}/${repo}/commits/${ref}/check-suites`,
    {
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: "application/vnd.github+json",
        "X-GitHub-Api-Version": "2022-11-28",
      },
    }
  )

  if (!response.ok) {
    throw new Error(`Failed to fetch check suites (${response.status})`)
  }

  const data = (await response.json()) as {
    check_suites: RawCheckSuite[]
  }

  return data.check_suites.filter(isRelevantCheckSuite).map((suite) => ({
    status: suite.status,
    conclusion: suite.conclusion,
  }))
}
