import assert from "node:assert/strict"
import { test } from "node:test"

import { isDiscardedRunEvent, rememberDiscardedRuns } from "./discarded-runs"

test("remembers a discarded run across successive resets", () => {
  const first = rememberDiscardedRuns(new Set(), ["run-1"])
  const second = rememberDiscardedRuns(first, ["run-2"])

  assert.deepEqual([...second], ["run-1", "run-2"])
})

// A reset of an issue with no run in flight has nothing to discard, and must
// not turn the set into something that swallows the next run's events.
test("leaves the discarded set alone when a reset discarded nothing", () => {
  const discarded = rememberDiscardedRuns(new Set(["run-1"]), [])

  assert.deepEqual([...discarded], ["run-1"])
})

test("does not mutate the discarded set it was given", () => {
  const current = new Set(["run-1"])
  rememberDiscardedRuns(current, ["run-2"])

  assert.deepEqual([...current], ["run-1"])
})

// The whole point: the worker behind the wiped run is still streaming.
test("rejects a broadcast from a run a reset threw away", () => {
  assert.equal(
    isDiscardedRunEvent(new Set(["run-1"]), { run_id: "run-1" }),
    true
  )
})

test("keeps a broadcast from the run that replaced the discarded one", () => {
  assert.equal(
    isDiscardedRunEvent(new Set(["run-1"]), { run_id: "run-2" }),
    false
  )
})

// `run_id` is optional on the wire, so an untagged event carries no evidence
// that it is stale — dropping it would silence a legitimate message.
test("keeps an untagged broadcast", () => {
  const discarded = new Set(["run-1"])

  assert.equal(isDiscardedRunEvent(discarded, { run_id: null }), false)
  assert.equal(isDiscardedRunEvent(discarded, {}), false)
})

test("keeps every broadcast before any reset has happened", () => {
  assert.equal(isDiscardedRunEvent(new Set(), { run_id: "run-1" }), false)
})
