import assert from "node:assert/strict"
import { test } from "node:test"

import type { ReviewRunContext } from "@gentic/validators/agent"

import {
  ReviewerOutputInvalidError,
  buildReviewerEnv,
  buildReviewerPromptText,
  extractReviewerOutput,
} from "./review-session.js"

test("buildReviewerEnv strips push-capable credentials and locks git out of every config file", () => {
  const baseEnv = {
    PATH: "/usr/bin",
    ANTHROPIC_API_KEY: "sk-keep-me",
    SSH_AUTH_SOCK: "/tmp/ssh-agent.sock",
    SSH_AGENT_PID: "1234",
    GIT_ASKPASS: "/usr/bin/askpass",
    GIT_SSH_COMMAND: "ssh -i /home/host/.ssh/id_ed25519",
    GIT_SSH: "/usr/bin/ssh",
    GH_TOKEN: "gho_secret",
    GITHUB_TOKEN: "ghp_secret",
  }

  const env = buildReviewerEnv({}, baseEnv)

  assert.equal(env.PATH, "/usr/bin")
  assert.equal(env.ANTHROPIC_API_KEY, "sk-keep-me")
  assert.equal(env.SSH_AUTH_SOCK, undefined)
  assert.equal(env.SSH_AGENT_PID, undefined)
  assert.equal(env.GIT_ASKPASS, undefined)
  assert.equal(env.GIT_SSH_COMMAND, undefined)
  assert.equal(env.GIT_SSH, undefined)
  assert.equal(env.GH_TOKEN, undefined)
  assert.equal(env.GITHUB_TOKEN, undefined)
  assert.equal(env.GIT_CONFIG_GLOBAL, "/dev/null")
  assert.equal(env.GIT_CONFIG_SYSTEM, "/dev/null")
})

test("buildReviewerEnv layers the provider's own launch config over the base env", () => {
  const env = buildReviewerEnv(
    { CLAUDE_CODE_EXECUTABLE: "/vendor/claude-agent-acp/claude" },
    { PATH: "/usr/bin" }
  )

  assert.equal(env.PATH, "/usr/bin")
  assert.equal(
    env.CLAUDE_CODE_EXECUTABLE,
    "/vendor/claude-agent-acp/claude"
  )
})

const baseContext: ReviewRunContext = {
  issue: { code: "GEN-415", title: "Title", body: "Body" },
  attachments: [],
  repo: "gentic/app",
  reviewerProvider: "claude_code",
  reviewerModel: null,
  reviewerInstructions: null,
  pullRequest: {
    url: "https://github.com/gentic/app/pull/42",
    headSha: "abc123",
    ciState: "success",
    title: "PR title",
    body: "PR body",
    baseRef: "main",
    baseSha: "def456",
  },
}

test("buildReviewerPromptText includes issue, PR, CI evidence, and the diff", () => {
  const prompt = buildReviewerPromptText(baseContext, "diff --git a b\n+line")

  assert.match(prompt, /GEN-415/)
  assert.match(prompt, /Title/)
  assert.match(prompt, /Body/)
  assert.match(prompt, /https:\/\/github\.com\/gentic\/app\/pull\/42/)
  assert.match(prompt, /CI status for this exact head SHA: success/)
  assert.match(prompt, /diff --git a b/)
})

test("buildReviewerPromptText includes additive reviewer instructions only when present", () => {
  const withInstructions = buildReviewerPromptText(
    { ...baseContext, reviewerInstructions: "Pay extra attention to auth." },
    ""
  )
  assert.match(withInstructions, /Pay extra attention to auth\./)

  const withoutInstructions = buildReviewerPromptText(baseContext, "")
  assert.doesNotMatch(
    withoutInstructions,
    /Additional project reviewer instructions/
  )
})

test("extractReviewerOutput parses the last fenced json block", () => {
  const text = [
    "Here is an earlier ```json { \"not\": \"this one\" } ``` example.",
    "",
    "```json",
    JSON.stringify({
      verdict: "changes_requested",
      summary: "One blocking issue.",
      findings: [
        {
          defect: "Unbounded recursion",
          evidence: "foo() calls itself with no base case",
          impact: "stack overflow on any nonempty input",
          requestedChange: "add a base case",
        },
      ],
    }),
    "```",
  ].join("\n")

  const output = extractReviewerOutput(text)
  assert.equal(output.verdict, "changes_requested")
  assert.equal(output.findings.length, 1)
  assert.equal(output.findings[0]?.defect, "Unbounded recursion")
})

test("extractReviewerOutput throws ReviewerOutputInvalidError when no json block exists", () => {
  assert.throws(
    () => extractReviewerOutput("The code looks fine to me."),
    (error: unknown) => error instanceof ReviewerOutputInvalidError
  )
})

test("extractReviewerOutput throws ReviewerOutputInvalidError on malformed JSON", () => {
  assert.throws(
    () => extractReviewerOutput("```json\n{ not valid json\n```"),
    (error: unknown) => error instanceof ReviewerOutputInvalidError
  )
})

test("extractReviewerOutput throws ReviewerOutputInvalidError when a finding is missing a required field", () => {
  const text = [
    "```json",
    JSON.stringify({
      verdict: "changes_requested",
      findings: [{ defect: "Missing evidence/impact/requestedChange" }],
    }),
    "```",
  ].join("\n")

  assert.throws(
    () => extractReviewerOutput(text),
    (error: unknown) => error instanceof ReviewerOutputInvalidError
  )
})

test("extractReviewerOutput accepts an approved verdict with no findings", () => {
  const text = ["```json", JSON.stringify({ verdict: "approved" }), "```"].join(
    "\n"
  )

  const output = extractReviewerOutput(text)
  assert.equal(output.verdict, "approved")
  assert.deepEqual(output.findings, [])
})
