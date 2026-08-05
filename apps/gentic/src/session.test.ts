import assert from "node:assert/strict"
import test from "node:test"

import type { McpServer } from "@agentclientprotocol/sdk"

import { GENTIC_MCP_SERVER_NAME } from "./mcp.js"
import {
  buildResumeSessionRequest,
  getAgentProviderConfig,
  type AgentProvider,
} from "./session.js"

const genticMcp = {
  apiUrl: "https://app.gentic.chat/api/v1",
  credential: "gtwc_worker-credential",
}

const expectedGenticServer = {
  type: "http",
  name: GENTIC_MCP_SERVER_NAME,
  url: "https://app.gentic.chat/mcp",
  headers: [{ name: "Authorization", value: "Bearer gtwc_worker-credential" }],
}

function newSessionServers(
  agentProvider: AgentProvider,
  resumeSessionId: string | null
): McpServer[] {
  const config = getAgentProviderConfig({ agentProvider, issueModel: null })

  return config.newSession({
    cwd: "/tmp/repo",
    issueModel: null,
    resumeSessionId,
    genticMcp,
  }).mcpServers
}

const HIDDEN_INSTRUCTION_PATTERNS = [
  /pull request/i,
  /\bcommit(ted|s)?\b/i,
  /\bpush(ed)?\b/i,
  /\bgh\b/i,
  /conventional commits/i,
]

test("claude code system prompt carries no hidden commit/push/PR instructions", () => {
  const config = getAgentProviderConfig({
    agentProvider: "claude_code",
    issueModel: null,
  })
  const request = config.newSession({
    cwd: "/tmp/repo",
    issueModel: null,
    resumeSessionId: null,
  })
  const serialized = JSON.stringify(request)

  for (const pattern of HIDDEN_INSTRUCTION_PATTERNS) {
    assert.doesNotMatch(serialized, pattern)
  }
})

test("claude code system prompt stays a bare preset regardless of follow-up context", () => {
  const config = getAgentProviderConfig({
    agentProvider: "claude_code",
    issueModel: null,
  })
  const request = config.newSession({
    cwd: "/tmp/repo",
    issueModel: null,
    resumeSessionId: "resume-1",
  }) as unknown as {
    _meta: { claudeCode: { options: { systemPrompt: unknown } } }
  }

  assert.deepEqual(request._meta.claudeCode.options.systemPrompt, {
    type: "preset",
    preset: "claude_code",
  })
})

test("codex session request carries no hidden instructions to prepend", () => {
  const config = getAgentProviderConfig({
    agentProvider: "codex",
    issueModel: null,
  })
  const request = config.newSession({
    cwd: "/tmp/repo",
    issueModel: null,
    resumeSessionId: null,
  })

  assert.deepEqual(request, { cwd: "/tmp/repo", mcpServers: [] })
})

test("fresh sessions for both providers receive the authenticated Gentic MCP server", () => {
  for (const provider of ["claude_code", "codex"] as const) {
    assert.deepEqual(
      newSessionServers(provider, null),
      [expectedGenticServer],
      provider
    )
  }
})

test("resumed sessions for both providers receive the same MCP configuration", () => {
  // Claude Code resumes through `session/new` with a `resume` option...
  assert.deepEqual(newSessionServers("claude_code", "resume-1"), [
    expectedGenticServer,
  ])

  // ...while Codex reconnects through `session/resume`, which has to
  // re-declare the servers for the resumed session.
  assert.deepEqual(
    buildResumeSessionRequest({
      sessionId: "resume-1",
      cwd: "/tmp/repo",
      issueModel: null,
      resumeSessionId: "resume-1",
      genticMcp,
    }),
    {
      sessionId: "resume-1",
      cwd: "/tmp/repo",
      mcpServers: [expectedGenticServer],
    }
  )
})

test("sessions carry no MCP server when the worker has no MCP access", () => {
  for (const provider of ["claude_code", "codex"] as const) {
    assert.deepEqual(
      getAgentProviderConfig({
        agentProvider: provider,
        issueModel: null,
      }).newSession({
        cwd: "/tmp/repo",
        issueModel: null,
        resumeSessionId: null,
        genticMcp: null,
      }).mcpServers,
      [],
      provider
    )
  }

  assert.deepEqual(
    buildResumeSessionRequest({
      sessionId: "resume-1",
      cwd: "/tmp/repo",
      issueModel: null,
      resumeSessionId: "resume-1",
      genticMcp: null,
    }).mcpServers,
    []
  )
})

test("injecting the Gentic MCP server changes nothing else about the session request", () => {
  const claude = getAgentProviderConfig({
    agentProvider: "claude_code",
    issueModel: "sonnet",
  })
  const withMcp = claude.newSession({
    cwd: "/tmp/repo",
    issueModel: "sonnet",
    resumeSessionId: "resume-1",
    genticMcp,
  })
  const withoutMcp = claude.newSession({
    cwd: "/tmp/repo",
    issueModel: "sonnet",
    resumeSessionId: "resume-1",
    genticMcp: null,
  })

  assert.deepEqual(
    { ...withMcp, mcpServers: [] },
    { ...withoutMcp, mcpServers: [] }
  )
})

test("the Gentic MCP server carries no hidden agent instructions", () => {
  const serialized = JSON.stringify(newSessionServers("claude_code", null))

  for (const pattern of HIDDEN_INSTRUCTION_PATTERNS) {
    assert.doesNotMatch(serialized, pattern)
  }
})
