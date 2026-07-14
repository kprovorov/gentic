import assert from "node:assert/strict"
import { test } from "node:test"

import { formatChangesRequestedMessage } from "./chat"

test("formatChangesRequestedMessage includes review body and inline comments", () => {
  const message = formatChangesRequestedMessage(
    "https://github.com/acme/widget/pull/42",
    {
      id: 1,
      reviewerLogin: "reviewer",
      body: "Needs another pass.",
      comments: [
        {
          path: "src/app.ts",
          line: 12,
          diffHunk: "@@ -1 +1 @@",
          body: "Handle null here.",
        },
      ],
    }
  )

  assert.match(message, /@reviewer requested changes/)
  assert.match(message, /Needs another pass\./)
  assert.match(message, /\*\*src\/app\.ts:12\*\*/)
  assert.match(message, /Handle null here\./)
})
