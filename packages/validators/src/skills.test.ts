import assert from "node:assert/strict"
import test from "node:test"

import {
  createHostSkillInstallsInputSchema,
  parseSkillsShSkillUrl,
  sanitizeSkillInstallOutput,
  skillsShSkillUrlSchema,
  SkillUrlError,
} from "./skills.js"

test("parses a canonical single-skill skills.sh URL", () => {
  assert.deepEqual(
    parseSkillsShSkillUrl("https://skills.sh/vercel-labs/agent-skills/dataviz"),
    {
      source: "vercel-labs/agent-skills",
      skill: "dataviz",
      url: "https://skills.sh/vercel-labs/agent-skills/dataviz",
    }
  )
})

test("normalizes the host, scheme, trailing slash and tracking parameters", () => {
  for (const input of [
    "  http://www.skills.sh/anthropics/skills/pdf/  ",
    "https://skills.sh/anthropics/skills/pdf?utm_source=x#top",
  ]) {
    assert.equal(
      parseSkillsShSkillUrl(input).url,
      "https://skills.sh/anthropics/skills/pdf",
      input
    )
  }
})

test("rejects URLs that do not identify exactly one skill", () => {
  const rejected = [
    "",
    "not a url",
    "anthropics/skills/pdf",
    "ftp://skills.sh/anthropics/skills/pdf",
    "https://skills.sh.evil.com/anthropics/skills/pdf",
    "https://github.com/anthropics/skills",
    "https://skills.sh/anthropics",
    "https://skills.sh/anthropics/skills",
    "https://skills.sh/anthropics/skills/pdf/extra",
    "https://skills.sh/p/some-pack",
    "https://skills.sh/t/writing",
    "https://skills.sh/leaderboard",
    "https://skills.sh/anthropics/skills/..",
    "https://skills.sh/anthropics/skills/-leading-dash",
  ]

  for (const input of rejected) {
    assert.throws(
      () => parseSkillsShSkillUrl(input),
      SkillUrlError,
      `expected ${input} to be rejected`
    )
  }
})

test("the URL schema surfaces the rejection message instead of throwing", () => {
  const result = skillsShSkillUrlSchema.safeParse("https://skills.sh/p/pack")

  assert.equal(result.success, false)
  assert.match(result.error.issues[0].message, /single skill/)
})

test("install input requires at least one host and defaults risk acceptance off", () => {
  const parsed = createHostSkillInstallsInputSchema.parse({
    url: "https://skills.sh/anthropics/skills/pdf",
    host_ids: ["11111111-1111-4111-8111-111111111111"],
  })

  assert.equal(parsed.accept_risk, false)
  assert.equal(
    createHostSkillInstallsInputSchema.safeParse({
      url: "https://skills.sh/anthropics/skills/pdf",
      host_ids: [],
    }).success,
    false
  )
})

test("sanitizes credentials, machine paths and control codes out of CLI output", () => {
  const sanitized = sanitizeSkillInstallOutput(
    [
      "\u001B[31mError\u001B[0m: install failed",
      "host credential gtwc_abcdefghijklmnopqrstuvwxyz012345",
      "GITHUB_TOKEN=ghp_abcdefghijklmnopqrstuvwxyz0123456789",
      "authorization: Bearer eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.dozjgNryP4J3jVmNHl0w5N",
      "npm error path /Users/ada/.claude/skills",
      "cloning https://ada:hunter2@example.com/repo.git",
    ].join("\n")
  )

  assert.match(sanitized, /^Error: install failed$/m)
  assert.doesNotMatch(sanitized, /gtwc_/)
  assert.doesNotMatch(sanitized, /ghp_/)
  assert.doesNotMatch(sanitized, /eyJhbGciOiJIUzI1NiJ9/)
  assert.doesNotMatch(sanitized, /hunter2/)
  assert.doesNotMatch(sanitized, /ada/)
  assert.match(sanitized, /GITHUB_TOKEN=\[redacted\]/)
  assert.match(sanitized, /npm error path ~\/\.claude\/skills/)
})

test("keeps the tail of oversized CLI output", () => {
  const sanitized = sanitizeSkillInstallOutput(
    `${"a".repeat(20_000)}\nfinal failure line`
  )

  assert.ok(sanitized.length < 9_000)
  assert.ok(sanitized.startsWith("...\n"))
  assert.ok(sanitized.endsWith("final failure line"))
})
