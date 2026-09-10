import { randomBytes } from "node:crypto"
import { redirect } from "next/navigation"
import { auth } from "@clerk/nextjs/server"

import { createServiceClient } from "@gentic/supabase/service"
import { ServiceError } from "@gentic/services/errors"
import * as githubIntegrationsService from "@gentic/services/github-integrations"

import {
  buildGithubUserAuthorizationUrl,
  getGithubOAuthCredentials,
  verifyInstallationOwnership,
} from "@/lib/github-app"

export const runtime = "nodejs"

type CallbackDependencies = {
  consumeState: (
    userId: string,
    state: string
  ) => Promise<{ installationId: string | null }>
  createState: (
    userId: string,
    state: string,
    installationId: string | null
  ) => Promise<void>
  upsertIntegration: (
    userId: string,
    input: {
      installationId: string | null
      setupAction: string | null
      status: githubIntegrationsService.GithubIntegrationStatus
    }
  ) => Promise<unknown>
  verifyInstallationOwnership: (
    code: string,
    installationId: string
  ) => Promise<boolean>
  oauthCredentials: () => { clientId: string; clientSecret: string } | null
  generateState: () => string
}

/**
 * Handles both hops of the connect flow, which GitHub sends to the same URL.
 *
 * 1. GitHub finishes the App installation and redirects here with
 *    `installation_id` — a value the browser controls, and one that decides
 *    whose repositories Gentic will act on. Unless GitHub also sent a `code`
 *    (which it does only when the App requests user authorization during
 *    installation), we bounce the user through the App's user-authorization
 *    flow, carrying the pending installation id on a fresh state row.
 * 2. GitHub returns with `code`, which we exchange for a user access token
 *    and check the installation against `GET /user/installations`.
 *
 * Nothing is written until that check passes.
 */
export async function completeGithubCallback(
  request: Request,
  userId: string,
  deps: CallbackDependencies
) {
  const url = new URL(request.url)
  const state = url.searchParams.get("state")
  const setupAction = url.searchParams.get("setup_action")
  const code = url.searchParams.get("code")

  if (!state) {
    return "/settings?github=missing-state"
  }

  const consumed = await deps.consumeState(userId, state)

  if (setupAction === "request") {
    // An org install awaiting admin approval: there is no installation yet,
    // so there is nothing to verify and nothing privileged to record.
    await deps.upsertIntegration(userId, {
      installationId: null,
      setupAction,
      status: "pending",
    })
    return "/settings?github=pending"
  }

  const installationId =
    url.searchParams.get("installation_id") ?? consumed.installationId

  if (!installationId) {
    return "/settings?github=missing-installation"
  }

  const credentials = deps.oauthCredentials()
  if (!credentials) {
    console.error(
      "[github-callback] GITHUB_APP_CLIENT_ID / GITHUB_APP_CLIENT_SECRET are not configured"
    )
    return "/settings?github=not-configured"
  }

  if (!code) {
    const nextState = deps.generateState()
    await deps.createState(userId, nextState, installationId)
    return buildGithubUserAuthorizationUrl(credentials.clientId, nextState)
  }

  if (!(await deps.verifyInstallationOwnership(code, installationId))) {
    return "/settings?github=installation-unverified"
  }

  try {
    await deps.upsertIntegration(userId, {
      installationId,
      setupAction,
      status: "connected",
    })
  } catch (error) {
    if (error instanceof ServiceError && error.code === "conflict") {
      return "/settings?github=installation-conflict"
    }
    throw error
  }

  return "/settings?github=connected"
}

export async function GET(request: Request) {
  const { userId } = await auth()

  if (!userId) {
    redirect("/login")
  }

  // Writes to `github_integrations` are no longer granted to `authenticated`,
  // so that the ownership check above cannot be bypassed by writing the row
  // straight through PostgREST. That puts this flow on the service client,
  // with the Clerk user id derived here rather than taken from the request.
  const supabase = createServiceClient()
  const destination = await completeGithubCallback(request, userId, {
    consumeState: (ownerId, state) =>
      githubIntegrationsService.consumeGithubIntegrationState(
        supabase,
        ownerId,
        state
      ),
    createState: (ownerId, state, installationId) =>
      githubIntegrationsService.createGithubIntegrationState(
        supabase,
        ownerId,
        state,
        installationId
      ),
    upsertIntegration: (ownerId, input) =>
      githubIntegrationsService.upsertGithubIntegration(
        supabase,
        ownerId,
        input
      ),
    verifyInstallationOwnership,
    oauthCredentials: getGithubOAuthCredentials,
    generateState: () => randomBytes(32).toString("base64url"),
  })

  redirect(destination)
}
