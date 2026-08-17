import assert from "node:assert/strict"
import test from "node:test"

import { ServiceError } from "@gentic/services/errors"
import { SkillAuditGateError } from "@gentic/services/skills"

import { createSkillAuditRoute } from "../app/api/app/skills/audit/route"
import {
  createSkillInstallsPollRoute,
  createSkillInstallsRoute,
} from "../app/api/app/skills/installs/route"

const skill = {
  source: "anthropics/skills",
  skill: "pdf",
  url: "https://skills.sh/anthropics/skills/pdf",
}

const allowGate = { decision: "allow" as const, reasons: [], audits: [] }

const authenticated = async () => ({ supabase: {}, userId: "user_1" }) as never

function auditRequest(url: string) {
  return new Request(
    `https://app.example/api/app/skills/audit?url=${encodeURIComponent(url)}`
  )
}

test("skill routes reject anonymous callers before touching any skill state", async () => {
  const routes = [
    createSkillAuditRoute({
      getContext: async () => null,
      resolveGate: async () => {
        throw new Error("should not resolve audits")
      },
    }),
    createSkillInstallsRoute({
      getContext: async () => null,
      createInstalls: async () => {
        throw new Error("should not dispatch installs")
      },
    }),
    createSkillInstallsPollRoute({
      getContext: async () => null,
      listInstalls: async () => {
        throw new Error("should not read installs")
      },
    }),
  ]

  for (const route of routes) {
    const response = await route(
      new Request("https://app.example/api/app/skills/installs", {
        method: "POST",
        body: "{}",
      })
    )

    assert.equal(response.status, 401)
    assert.deepEqual(await response.json(), {
      error: { code: "unauthorized", message: "Unauthorized" },
    })
  }
})

test("the audit route returns the parsed skill and its gate", async () => {
  const route = createSkillAuditRoute({
    getContext: authenticated,
    resolveGate: async (requested) => {
      assert.deepEqual(requested, skill)
      return allowGate
    },
  })

  const response = await route(auditRequest(skill.url))

  assert.equal(response.status, 200)
  assert.equal(response.headers.get("Cache-Control"), "private, no-store")
  assert.deepEqual(await response.json(), { skill, gate: allowGate })
})

test("the audit route rejects URLs that do not name a single skill", async () => {
  const route = createSkillAuditRoute({
    getContext: authenticated,
    resolveGate: async () => {
      throw new Error("should not resolve audits for an invalid URL")
    },
  })

  const response = await route(auditRequest("https://skills.sh/p/some-pack"))
  const body = (await response.json()) as { error: { code: string } }

  assert.equal(response.status, 400)
  assert.equal(body.error.code, "validation")
})

test("a refused audit gate answers 409 and carries the gate back to the dialog", async () => {
  const gate = {
    decision: "confirm" as const,
    reasons: ["warning" as const],
    audits: [{ provider: "Socket", status: "warn" as const }],
  }
  const route = createSkillInstallsRoute({
    getContext: authenticated,
    createInstalls: async () => {
      throw new SkillAuditGateError("Accept the risk to continue.", gate)
    },
  })

  const response = await route(
    new Request("https://app.example/api/app/skills/installs", {
      method: "POST",
      body: JSON.stringify({ url: skill.url, worker_ids: ["w1"] }),
    })
  )

  assert.equal(response.status, 409)
  assert.deepEqual(await response.json(), {
    error: { code: "audit_gate", message: "Accept the risk to continue." },
    gate,
  })
})

test("an ineligible worker fails the whole submission with its reason", async () => {
  const route = createSkillInstallsRoute({
    getContext: authenticated,
    createInstalls: async () => {
      throw new ServiceError(
        "conflict",
        "laptop can no longer be installed to (offline)."
      )
    },
  })

  const response = await route(
    new Request("https://app.example/api/app/skills/installs", {
      method: "POST",
      body: JSON.stringify({ url: skill.url, worker_ids: ["w1"] }),
    })
  )

  assert.equal(response.status, 409)
  assert.deepEqual(await response.json(), {
    error: {
      code: "conflict",
      message: "laptop can no longer be installed to (offline).",
    },
  })
})

test("the poll route reads only the ids it was given, scoped to the caller", async () => {
  let seen: { userId: string; ids: string[] } | null = null
  const route = createSkillInstallsPollRoute({
    getContext: authenticated,
    listInstalls: async (_supabase, userId, ids) => {
      seen = { userId, ids }
      return []
    },
  })

  const response = await route(
    new Request("https://app.example/api/app/skills/installs?ids=a,,%20b%20,c")
  )

  assert.equal(response.status, 200)
  assert.deepEqual(await response.json(), { installs: [] })
  assert.deepEqual(seen, { userId: "user_1", ids: ["a", "b", "c"] })
})
