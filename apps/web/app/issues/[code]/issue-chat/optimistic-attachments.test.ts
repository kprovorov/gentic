import assert from "node:assert/strict"
import test from "node:test"

import { createOptimisticAttachments } from "./optimistic-attachments"

test("createOptimisticAttachments creates local thumbnails only for image files", () => {
  const originalCreateObjectUrl = URL.createObjectURL
  const createdUrls: string[] = []

  Object.defineProperty(URL, "createObjectURL", {
    configurable: true,
    value(file: File) {
      const url = `blob:${file.name}`
      createdUrls.push(url)
      return url
    },
  })

  try {
    const registeredUrls: string[] = []
    const attachments = createOptimisticAttachments(
      [
        new File(["image"], "screenshot.png", { type: "image/png" }),
        new File(["notes"], "notes.txt", { type: "text/plain" }),
        new File([], "empty.jpg", { type: "image/jpeg" }),
      ],
      (url) => registeredUrls.push(url)
    )

    assert.equal(attachments.length, 2)
    assert.equal(attachments[0]?.fileName, "screenshot.png")
    assert.equal(attachments[0]?.thumbnailUrl, "blob:screenshot.png")
    assert.equal(attachments[1]?.fileName, "notes.txt")
    assert.equal(attachments[1]?.thumbnailUrl, null)
    assert.deepEqual(createdUrls, ["blob:screenshot.png"])
    assert.deepEqual(registeredUrls, ["blob:screenshot.png"])
  } finally {
    Object.defineProperty(URL, "createObjectURL", {
      configurable: true,
      value: originalCreateObjectUrl,
    })
  }
})
