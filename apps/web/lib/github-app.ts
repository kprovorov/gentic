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
    throw new Error(
      "GITHUB_APP_ID / GITHUB_APP_PRIVATE_KEY are not configured"
    )
  }

  const now = Math.floor(Date.now() / 1000)
  const header = base64url(JSON.stringify({ alg: "RS256", typ: "JWT" }))
  const payload = base64url(
    JSON.stringify({ iat: now - 60, exp: now + APP_JWT_TTL_SECONDS, iss: appId })
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

export type GithubCheckSuite = {
  status: string
  conclusion: string | null
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
    check_suites: { status: string; conclusion: string | null }[]
  }

  return data.check_suites.map((suite) => ({
    status: suite.status,
    conclusion: suite.conclusion,
  }))
}
