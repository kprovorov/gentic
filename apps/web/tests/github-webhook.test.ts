import assert from "node:assert/strict"
import test from "node:test"

import {
  getWorkflowRunPullNumbers,
  isPendingCheckAction,
} from "../app/api/integrations/github/webhook/route"

test("getWorkflowRunPullNumbers reads pull request numbers from workflow_run payloads", () => {
  assert.deepEqual(
    getWorkflowRunPullNumbers({
      workflow_run: {
        head_sha: "abc123",
        pull_requests: [{ number: 42 }, { number: 43 }],
      },
    }),
    [42, 43]
  )
})

test("getWorkflowRunPullNumbers tolerates workflow_run payloads without pull requests", () => {
  assert.deepEqual(
    getWorkflowRunPullNumbers({
      workflow_run: {
        head_sha: "abc123",
      },
    }),
    []
  )
})

test("isPendingCheckAction recognizes GitHub rerun webhook actions", () => {
  assert.equal(isPendingCheckAction("check_suite", "rerequested"), true)
  assert.equal(isPendingCheckAction("check_run", "rerequested"), true)
  assert.equal(isPendingCheckAction("workflow_run", "requested"), true)
})

test("isPendingCheckAction rejects completed and unrelated webhook actions", () => {
  assert.equal(isPendingCheckAction("check_suite", "completed"), false)
  assert.equal(isPendingCheckAction("check_run", "created"), false)
  assert.equal(isPendingCheckAction("workflow_run", "completed"), false)
})
