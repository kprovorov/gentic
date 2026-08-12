import assert from "node:assert/strict"
import test from "node:test"

import {
  createAttachmentSigner,
  type SignableAttachment,
} from "./attachment-signing"

type SignCall = { path: string; transformed: boolean; transform: unknown }

function attachment(
  overrides: Partial<SignableAttachment> = {}
): SignableAttachment {
  return {
    id: "attachment-1",
    file_name: "screenshot.png",
    content_type: "image/png",
    size_bytes: 78_100,
    storage_path: "issue-1/screenshot.png",
    deleted_at: null,
    ...overrides,
  }
}

// Storage Image Transformations are a paid add-on, so `transformsEnabled`
// stands in for whether the project has them: without it Storage rejects the
// signing call that carries transform options.
function createSupabase({
  transformsEnabled = true,
  signingError = null,
}: { transformsEnabled?: boolean; signingError?: string | null } = {}) {
  const calls: SignCall[] = []

  const supabase = {
    storage: {
      from(bucket: string) {
        assert.equal(bucket, "attachments")
        return {
          createSignedUrl(
            path: string,
            _expiresIn: number,
            options?: { transform?: unknown }
          ) {
            const transformed = Boolean(options?.transform)
            calls.push({ path, transformed, transform: options?.transform })

            if (signingError) {
              return Promise.resolve({
                data: null,
                error: { message: signingError },
              })
            }

            if (transformed && !transformsEnabled) {
              return Promise.resolve({
                data: null,
                error: { message: "Image transformation is not enabled" },
              })
            }

            return Promise.resolve({
              data: {
                signedUrl: transformed
                  ? `https://signed.test/${path}?thumb=1`
                  : `https://signed.test/${path}`,
              },
              error: null,
            })
          },
        }
      },
    },
  }

  return { supabase, calls }
}

test("serves the resized URL as the thumbnail when Storage can transform", async () => {
  const { supabase } = createSupabase()

  const signed = await createAttachmentSigner(supabase as never)(attachment())

  assert.deepEqual(signed, {
    id: "attachment-1",
    fileName: "screenshot.png",
    sizeBytes: 78_100,
    url: "https://signed.test/issue-1/screenshot.png",
    thumbnailUrl: "https://signed.test/issue-1/screenshot.png?thumb=1",
  })
})

// The chip letterboxes the thumbnail, which only shows the whole image if the
// bytes it gets were not already cropped square on the way out of Storage.
test("asks Storage to fit the whole image inside the thumbnail box", async () => {
  const { supabase, calls } = createSupabase()

  await createAttachmentSigner(supabase as never)(attachment())

  const thumbnail = calls.find((call) => call.transformed)
  assert.deepEqual(thumbnail?.transform, {
    width: 96,
    height: 96,
    resize: "contain",
  })
})

test("falls back to the full-size URL when transformations are unavailable", async () => {
  const { supabase } = createSupabase({ transformsEnabled: false })

  const signed = await createAttachmentSigner(supabase as never)(attachment())

  assert.equal(
    signed.thumbnailUrl,
    "https://signed.test/issue-1/screenshot.png"
  )
  assert.equal(signed.url, signed.thumbnailUrl)
})

test("skips the full-size fallback for images too large to send as a preview", async () => {
  const { supabase } = createSupabase({ transformsEnabled: false })

  const signed = await createAttachmentSigner(supabase as never)(
    attachment({ size_bytes: 24 * 1024 * 1024 })
  )

  assert.equal(signed.url, "https://signed.test/issue-1/screenshot.png")
  assert.equal(signed.thumbnailUrl, null)
})

test("never asks for a thumbnail of a non-image", async () => {
  const { supabase, calls } = createSupabase()

  const signed = await createAttachmentSigner(supabase as never)(
    attachment({ file_name: "spec.pdf", content_type: "application/pdf" })
  )

  assert.equal(signed.thumbnailUrl, null)
  assert.deepEqual(calls, [
    {
      path: "issue-1/screenshot.png",
      transformed: false,
      transform: undefined,
    },
  ])
})

test("reports the Storage error when an attachment cannot be signed", async () => {
  const { supabase } = createSupabase({ signingError: "Object not found" })
  const logged: unknown[][] = []
  const consoleError = console.error
  console.error = (...args: unknown[]) => logged.push(args)

  try {
    const signed = await createAttachmentSigner(supabase as never)(attachment())

    assert.equal(signed.url, null)
    assert.equal(signed.thumbnailUrl, null)
  } finally {
    console.error = consoleError
  }

  assert.ok(
    logged.some((args) => args.some((arg) => arg === "Object not found")),
    "expected the Storage error to reach the server logs"
  )
})

// A file sent with a chat message is rendered twice on the issue page — inline
// with its message and in the Files section — and both go through the same
// per-request signer.
test("signs a repeated attachment once, even concurrently", async () => {
  const { supabase, calls } = createSupabase()
  const signAttachment = createAttachmentSigner(supabase as never)

  const [first, second] = await Promise.all([
    signAttachment(attachment()),
    signAttachment(attachment()),
  ])
  const third = await signAttachment(attachment())

  assert.deepEqual(first, second)
  assert.deepEqual(first, third)
  // One download URL and one thumbnail, not three of each.
  assert.equal(calls.length, 2)
})

test("keeps a deleted attachment's metadata but signs no URLs for it", async () => {
  const { supabase, calls } = createSupabase()

  const signed = await createAttachmentSigner(supabase as never)(
    attachment({ deleted_at: "2026-08-12T09:00:00.000Z" })
  )

  assert.deepEqual(signed, {
    id: "attachment-1",
    fileName: "screenshot.png",
    sizeBytes: 78_100,
    url: null,
    thumbnailUrl: null,
  })
  assert.deepEqual(calls, [])
})
