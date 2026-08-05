import assert from "node:assert/strict"
import test from "node:test"

import type { Supabase } from "@gentic/services/types"

import {
  backfillAttachedPullRequestState,
  parsePullNumber,
} from "../lib/pull-request-state"

test("parsePullNumber extracts the number from a PR URL", () => {
  assert.equal(
    parsePullNumber("https://github.com/kprovorov/gentic/pull/428"),
    428
  )
})

test("parsePullNumber tolerates trailing path segments", () => {
  assert.equal(
    parsePullNumber("https://github.com/kprovorov/gentic/pull/428/files"),
    428
  )
})

test("parsePullNumber returns null when there is no pull number", () => {
  assert.equal(parsePullNumber("https://github.com/kprovorov/gentic"), null)
  assert.equal(
    parsePullNumber("https://github.com/kprovorov/gentic/pull/"),
    null
  )
})

// These guard branches return before touching Supabase or GitHub, so a
// never-used stub client is enough to exercise them.
const unusedSupabase = null as unknown as Supabase

test("backfillAttachedPullRequestState is a no-op when the issue has no repo", async () => {
  await assert.doesNotReject(
    backfillAttachedPullRequestState(
      unusedSupabase,
      "user_1",
      null,
      "https://github.com/kprovorov/gentic/pull/428"
    )
  )
})

test("backfillAttachedPullRequestState is a no-op when the PR URL has no number", async () => {
  await assert.doesNotReject(
    backfillAttachedPullRequestState(
      unusedSupabase,
      "user_1",
      "kprovorov/gentic",
      "https://github.com/kprovorov/gentic"
    )
  )
})
