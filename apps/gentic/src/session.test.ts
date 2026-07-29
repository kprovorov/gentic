import assert from "node:assert/strict"
import test from "node:test"

import { getAgentProviderConfig } from "./session.js"

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
