import assert from "node:assert/strict"
import test from "node:test"

import { ServiceError } from "./errors"
import { upsertGithubIntegration } from "./github-integrations"

type UpsertResult =
  | { data: Record<string, unknown>; error: null }
  | { data: null; error: { code: string; message: string } }

function githubIntegrationClient(results: UpsertResult[]) {
  const writes: Array<Record<string, unknown>> = []

  return {
    writes,
    client: {
      from(table: string) {
        assert.equal(table, "github_integrations")
        return {
          upsert(
            values: Record<string, unknown>,
            options: { onConflict: string }
          ) {
            assert.deepEqual(options, { onConflict: "user_id" })
            writes.push(values)
            return {
              select(columns: string) {
                assert.equal(columns, "*")
                return {
                  async single() {
                    const result = results.shift()
                    assert.ok(result, "expected a mocked upsert result")
                    return result
                  },
                }
              },
            }
          },
        }
      },
    },
  }
}

function connectedIntegration(userId: string, installationId: string) {
  return {
    id: "10000000-0000-4000-8000-000000000601",
    user_id: userId,
    installation_id: installationId,
    setup_action: "install",
    status: "connected",
    connected_at: "2026-08-05T12:00:00.000Z",
    created_at: "2026-08-05T12:00:00.000Z",
    updated_at: "2026-08-05T12:00:00.000Z",
  }
}

test("upsertGithubIntegration lets the existing owner reconnect repeatedly", async () => {
  const row = connectedIntegration("user_alpha", "installation_123")
  const { client, writes } = githubIntegrationClient([
    { data: row, error: null },
    { data: row, error: null },
  ])

  const input = {
    installationId: "installation_123",
    setupAction: "install",
    status: "connected" as const,
  }

  const first = await upsertGithubIntegration(
    client as never,
    "user_alpha",
    input
  )
  const second = await upsertGithubIntegration(
    client as never,
    "user_alpha",
    input
  )

  assert.equal(first.id, row.id)
  assert.equal(second.id, row.id)
  assert.equal(writes.length, 2)
  assert.equal(writes[0]?.user_id, "user_alpha")
  assert.equal(writes[1]?.installation_id, "installation_123")
})

test("upsertGithubIntegration maps a competing ownership race to a conflict", async () => {
  const ownerRow = connectedIntegration("user_alpha", "installation_123")
  const { client } = githubIntegrationClient([
    { data: ownerRow, error: null },
    {
      data: null,
      error: {
        code: "23505",
        message:
          'duplicate key value violates unique constraint "github_integrations_installation_id_unique"',
      },
    },
  ])

  const [ownerAttempt, competingAttempt] = await Promise.allSettled([
    upsertGithubIntegration(client as never, "user_alpha", {
      installationId: "installation_123",
      setupAction: "install",
      status: "connected",
    }),
    upsertGithubIntegration(client as never, "user_beta", {
      installationId: "installation_123",
      setupAction: "install",
      status: "connected",
    }),
  ])

  assert.equal(ownerAttempt.status, "fulfilled")
  assert.equal(competingAttempt.status, "rejected")
  assert.ok(competingAttempt.reason instanceof ServiceError)
  assert.equal(competingAttempt.reason.code, "conflict")
  assert.equal(
    competingAttempt.reason.message,
    "This GitHub installation is already connected to another Gentic account."
  )
})

test("upsertGithubIntegration keeps unrelated database errors internal", async () => {
  const { client } = githubIntegrationClient([
    {
      data: null,
      error: { code: "42501", message: "permission denied" },
    },
  ])

  await assert.rejects(
    upsertGithubIntegration(client as never, "user_alpha", {
      installationId: "installation_123",
      setupAction: "install",
      status: "connected",
    }),
    (error) =>
      error instanceof ServiceError &&
      error.code === "internal" &&
      error.message === "permission denied"
  )
})
