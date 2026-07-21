import assert from "node:assert/strict"
import test from "node:test"
import { mkdtemp, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { buildAttachmentBlocks } from "./attachments.js"
import type { AgentApi, Attachment } from "./api.js"

function apiWithAttachments(byMessageId: Record<string, Attachment[]>): AgentApi {
  return {
    async claimNextQueuedIssue() {
      return null
    },
    async setRunState() {},
    async finishRun() {
      return true
    },
    async insertMessage() {
      return "message"
    },
    async fetchPendingUserMessages() {
      return []
    },
    async ackUserMessages() {},
    async fetchAttachments(_issueId: string, messageId: string) {
      return byMessageId[messageId] ?? []
    },
    async fetchRealtimeToken() {
      return {
        url: "http://127.0.0.1",
        apiKey: "key",
        token: "token",
        expiresAt: new Date().toISOString(),
      }
    },
  }
}

test("buildAttachmentBlocks uses only the current message attachment set", async () => {
  const dir = await mkdtemp(join(tmpdir(), "gentic-attachments-"))
  const originalFetch = globalThis.fetch
  globalThis.fetch = async (input) =>
    new Response(`body:${String(input)}`, {
      headers: { "content-type": "text/plain" },
    })

  try {
    const blocks = await buildAttachmentBlocks(
      apiWithAttachments({
        "message-1": [
          {
            id: "att-1",
            fileName: "current.txt",
            contentType: "text/plain",
            sizeBytes: 12,
            url: "https://example.test/current",
          },
        ],
        "message-2": [
          {
            id: "att-2",
            fileName: "later.txt",
            contentType: "text/plain",
            sizeBytes: 10,
            url: "https://example.test/later",
          },
        ],
      }),
      "issue-1",
      "message-1",
      dir
    )

    assert.equal(blocks.length, 1)
    assert.equal(blocks[0]?.type, "resource")
    assert.match(JSON.stringify(blocks[0]), /current/)
    assert.doesNotMatch(JSON.stringify(blocks[0]), /later/)
  } finally {
    globalThis.fetch = originalFetch
    await rm(dir, { recursive: true, force: true })
  }
})

test("buildAttachmentBlocks sends no files after current message attachments are deleted", async () => {
  const dir = await mkdtemp(join(tmpdir(), "gentic-attachments-"))

  try {
    const blocks = await buildAttachmentBlocks(
      apiWithAttachments({
        "message-1": [
          {
            id: "att-1",
            fileName: "earlier.txt",
            contentType: "text/plain",
            sizeBytes: 12,
            url: "https://example.test/earlier",
          },
        ],
        "message-2": [],
      }),
      "issue-1",
      "message-2",
      dir
    )

    assert.deepEqual(blocks, [])
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

test("buildAttachmentBlocks preserves duplicate filenames with stable resource uris", async () => {
  const dir = await mkdtemp(join(tmpdir(), "gentic-attachments-"))
  const originalFetch = globalThis.fetch
  globalThis.fetch = async (input) => new Response(`body:${String(input)}`)

  try {
    const blocks = await buildAttachmentBlocks(
      apiWithAttachments({
        "message-1": [
          {
            id: "att-1",
            fileName: "notes.txt",
            contentType: "text/plain",
            sizeBytes: 12,
            url: "https://example.test/one",
          },
          {
            id: "att-2",
            fileName: "notes.txt",
            contentType: "text/plain",
            sizeBytes: 12,
            url: "https://example.test/two",
          },
        ],
      }),
      "issue-1",
      "message-1",
      dir
    )

    assert.equal(blocks.length, 2)
    assert.deepEqual(
      blocks.map((block: (typeof blocks)[number]) =>
        block.type === "resource" ? block.resource.uri : null
      ),
      ["attachment:///notes.txt", "attachment:///notes-1.txt"]
    )
  } finally {
    globalThis.fetch = originalFetch
    await rm(dir, { recursive: true, force: true })
  }
})
