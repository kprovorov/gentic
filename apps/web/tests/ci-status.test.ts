import assert from "node:assert/strict"
import test from "node:test"

import { resolveCheckSuiteStatus } from "../lib/ci-status"

test("resolveCheckSuiteStatus waits when check suites are still running", () => {
  assert.equal(
    resolveCheckSuiteStatus([
      { status: "completed", conclusion: "success" },
      { status: "in_progress", conclusion: null },
    ]),
    "testing"
  )
})

test("resolveCheckSuiteStatus resolves already-passing check suites", () => {
  assert.equal(
    resolveCheckSuiteStatus([{ status: "completed", conclusion: "success" }]),
    "ready-for-review"
  )
})

test("resolveCheckSuiteStatus resolves already-failed check suites", () => {
  assert.equal(
    resolveCheckSuiteStatus([{ status: "completed", conclusion: "failure" }]),
    "tests-failed"
  )
})

test("resolveCheckSuiteStatus keeps no-CI pull requests ready for review", () => {
  assert.equal(resolveCheckSuiteStatus([]), "ready-for-review")
})
