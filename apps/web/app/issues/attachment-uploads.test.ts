import assert from "node:assert/strict"
import test from "node:test"

import {
  appendAttachmentDescriptors,
  appendAttachmentIds,
  uploadAttachmentFiles,
  type AttachmentUploadTicket,
  type SignedUploadClient,
} from "./attachment-uploads"

function ticket(index: number): AttachmentUploadTicket {
  return {
    attachmentId: `attachment-${index}`,
    path: `issue/file-${index}`,
    token: `token-${index}`,
    contentType: "text/plain",
  }
}

function recordingClient(results: Array<{ message: string } | null> = []): {
  client: SignedUploadClient
  calls: Array<{ path: string; token: string; fileName: string }>
} {
  const calls: Array<{ path: string; token: string; fileName: string }> = []
  let call = 0

  return {
    calls,
    client: {
      storage: {
        from: () => ({
          async uploadToSignedUrl(path, token, file) {
            calls.push({ path, token, fileName: file.name })
            return { error: results[call++] ?? null }
          },
        }),
      },
    },
  }
}

test("attachment descriptors carry only metadata, never the bytes", () => {
  const formData = new FormData()
  appendAttachmentDescriptors(formData, [
    new File(["a".repeat(2_000_000)], "big.png", { type: "image/png" }),
  ])

  assert.deepEqual(JSON.parse(String(formData.get("attachments"))), [
    { name: "big.png", type: "image/png", size: 2_000_000 },
  ])
  // A 2MB file would blow the Server Action body limit if it rode along.
  assert.deepEqual(formData.getAll("files"), [])
})

test("no descriptor field is written when nothing is attached", () => {
  const formData = new FormData()
  appendAttachmentDescriptors(formData, [])

  assert.equal(formData.get("attachments"), null)
})

test("each file is uploaded to the ticket minted for it, in order", async () => {
  const { client, calls } = recordingClient()
  const files = [new File(["one"], "one.txt"), new File(["two"], "two.txt")]

  const attachmentIds = await uploadAttachmentFiles(
    client,
    [ticket(0), ticket(1)],
    files
  )

  assert.deepEqual(attachmentIds, ["attachment-0", "attachment-1"])
  assert.deepEqual(calls, [
    { path: "issue/file-0", token: "token-0", fileName: "one.txt" },
    { path: "issue/file-1", token: "token-1", fileName: "two.txt" },
  ])
})

test("a failed upload names the file and abandons the rest of the batch", async () => {
  const { client, calls } = recordingClient([null, { message: "quota" }])

  await assert.rejects(
    uploadAttachmentFiles(
      client,
      [ticket(0), ticket(1), ticket(2)],
      [
        new File(["one"], "one.txt"),
        new File(["two"], "two.txt"),
        new File(["three"], "three.txt"),
      ]
    ),
    /Could not upload "two.txt": quota/
  )

  assert.equal(calls.length, 2)
})

test("a ticket/file mismatch fails before anything is uploaded", async () => {
  const { client, calls } = recordingClient()

  await assert.rejects(
    uploadAttachmentFiles(
      client,
      [ticket(0)],
      [new File(["one"], "one.txt"), new File(["two"], "two.txt")]
    ),
    /do not match/
  )

  assert.equal(calls.length, 0)
})

test("attachment ids are appended one per entry for the finish action", () => {
  const formData = new FormData()
  appendAttachmentIds(formData, ["attachment-0", "attachment-1"])

  assert.deepEqual(formData.getAll("attachment_id"), [
    "attachment-0",
    "attachment-1",
  ])
})
