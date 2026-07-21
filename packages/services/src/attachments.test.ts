import assert from "node:assert/strict"
import test from "node:test"

import { ServiceError } from "./errors"
import {
  MAX_ATTACHMENT_BYTES,
  rollbackMessageAttachmentUpload,
  validateAttachmentBatch,
} from "./attachments"

test("validateAttachmentBatch allows duplicate filenames within prompt limits", () => {
  assert.doesNotThrow(() =>
    validateAttachmentBatch([
      { name: "notes.txt", size: 1024 },
      { name: "notes.txt", size: 2048 },
    ])
  )
})

test("validateAttachmentBatch enforces per-file and aggregate limits", () => {
  assert.throws(
    () =>
      validateAttachmentBatch([
        { name: "large.bin", size: MAX_ATTACHMENT_BYTES + 1 },
      ]),
    (error) =>
      error instanceof ServiceError &&
      error.code === "validation" &&
      error.message.includes("larger than 25MB")
  )

  assert.throws(
    () =>
      validateAttachmentBatch([
        { name: "a.bin", size: 20 * 1024 * 1024 },
        { name: "b.bin", size: 20 * 1024 * 1024 },
        { name: "c.bin", size: 20 * 1024 * 1024 },
      ]),
    (error) =>
      error instanceof ServiceError &&
      error.code === "validation" &&
      error.message.includes("cannot exceed 50MB")
  )
})

test("rollbackMessageAttachmentUpload removes blobs, marks rows, then deletes message", async () => {
  const calls: string[] = []

  await rollbackMessageAttachmentUpload(
    {
      async listAttachments(issueId, messageId) {
        calls.push(`list:${issueId}:${messageId}`)
        return [
          { id: "att-1", storage_path: "issue/msg/file.txt" },
          { id: "att-2", storage_path: "issue/msg/file.txt" },
        ]
      },
      async removeStorageObjects(paths) {
        calls.push(`remove:${paths.join(",")}`)
      },
      async markAttachmentsDeleted(ids, storageDeletedAt) {
        calls.push(
          `mark:${ids.join(",")}:${storageDeletedAt ? "deleted" : "missing"}`
        )
      },
      async deleteMessage(issueId, messageId) {
        calls.push(`delete-message:${issueId}:${messageId}`)
      },
    },
    "issue-1",
    "message-1"
  )

  assert.deepEqual(calls, [
    "list:issue-1:message-1",
    "remove:issue/msg/file.txt,issue/msg/file.txt",
    "mark:att-1,att-2:deleted",
    "delete-message:issue-1:message-1",
  ])
})

test("rollbackMessageAttachmentUpload still marks rows and deletes message when blob cleanup fails", async () => {
  const calls: string[] = []

  await rollbackMessageAttachmentUpload(
    {
      async listAttachments() {
        calls.push("list")
        return [{ id: "att-1", storage_path: "issue/msg/file.txt" }]
      },
      async removeStorageObjects() {
        calls.push("remove")
        throw new Error("storage unavailable")
      },
      async markAttachmentsDeleted(ids, storageDeletedAt) {
        calls.push(
          `mark:${ids.join(",")}:${storageDeletedAt ? "deleted" : "missing"}`
        )
      },
      async deleteMessage() {
        calls.push("delete-message")
      },
    },
    "issue-1",
    "message-1"
  )

  assert.deepEqual(calls, [
    "list",
    "remove",
    "mark:att-1:missing",
    "delete-message",
  ])
})

test("rollbackMessageAttachmentUpload deletes failed messages with no attachment rows", async () => {
  const calls: string[] = []

  await rollbackMessageAttachmentUpload(
    {
      async listAttachments() {
        calls.push("list")
        return []
      },
      async removeStorageObjects() {
        calls.push("remove")
      },
      async markAttachmentsDeleted() {
        calls.push("mark")
      },
      async deleteMessage() {
        calls.push("delete-message")
      },
    },
    "issue-1",
    "message-1"
  )

  assert.deepEqual(calls, ["list", "delete-message"])
})
