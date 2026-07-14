import { mkdir, rm, writeFile } from "node:fs/promises"
import { join } from "node:path"

import type { ContentBlock } from "@agentclientprotocol/sdk"

import type { AgentApi, Attachment } from "./api.js"

const TEXT_MIME_TYPES = new Set([
  "application/json",
  "application/xml",
  "application/x-yaml",
  "application/yaml",
])

function isImage(attachment: Attachment): boolean {
  return (attachment.contentType ?? "").startsWith("image/")
}

function isText(attachment: Attachment): boolean {
  const type = attachment.contentType ?? ""
  return type.startsWith("text/") || TEXT_MIME_TYPES.has(type)
}

function sanitizeFileName(name: string, index: number): string {
  const base = name.split(/[/\\]/).pop() || `file-${index}`
  const cleaned = base.replace(/[^a-zA-Z0-9._-]/g, "_")
  return cleaned || `file-${index}`
}

function uniqueFileName(
  name: string,
  index: number,
  usedNames: Set<string>
): string {
  const sanitized = sanitizeFileName(name, index)
  if (!usedNames.has(sanitized)) {
    usedNames.add(sanitized)
    return sanitized
  }

  const dot = sanitized.lastIndexOf(".")
  const stem = dot > 0 ? sanitized.slice(0, dot) : sanitized
  const ext = dot > 0 ? sanitized.slice(dot) : ""
  for (let suffix = 1; ; suffix += 1) {
    const candidate = `${stem}-${suffix}${ext}`
    if (!usedNames.has(candidate)) {
      usedNames.add(candidate)
      return candidate
    }
  }
}

async function downloadBytes(url: string, fileName: string): Promise<Uint8Array> {
  const response = await fetch(url)
  if (!response.ok) {
    throw new Error(`Failed to download attachment "${fileName}": ${response.status}`)
  }
  return new Uint8Array(await response.arrayBuffer())
}

/**
 * Turns one user message's uploaded attachments into ACP content blocks for the
 * prompt turn. Images and text files are embedded directly (base64 `image`
 * blocks and inline `resource` text — no disk access needed by Claude Code).
 * The ACP agent we spawn ignores embedded binary resources and treats
 * `resource_link` as a bare pointer, so anything else is downloaded into
 * `attachmentsDir` and referenced by its local path instead. That directory
 * is a sibling of the repo clone, not inside it, so it can never end up
 * swept into the commit the agent is instructed to make.
 */
export async function buildAttachmentBlocks(
  api: AgentApi,
  issueId: string,
  messageId: string,
  attachmentsDir: string
): Promise<ContentBlock[]> {
  const attachments = await api.fetchAttachments(issueId, messageId)
  if (attachments.length === 0) {
    return []
  }

  // Re-downloaded fresh each run, so start from a clean directory.
  await rm(attachmentsDir, { recursive: true, force: true })

  const blocks: ContentBlock[] = []
  let dirCreated = false
  const usedNames = new Set<string>()

  for (const [index, attachment] of attachments.entries()) {
    const fileName = uniqueFileName(attachment.fileName, index, usedNames)

    if (isImage(attachment)) {
      const bytes = await downloadBytes(attachment.url, attachment.fileName)
      blocks.push({
        type: "image",
        data: Buffer.from(bytes).toString("base64"),
        mimeType: attachment.contentType ?? "application/octet-stream",
      })
      continue
    }

    if (isText(attachment)) {
      const bytes = await downloadBytes(attachment.url, attachment.fileName)
      blocks.push({
        type: "resource",
        resource: {
          uri: `attachment:///${fileName}`,
          text: Buffer.from(bytes).toString("utf-8"),
          mimeType: attachment.contentType ?? undefined,
        },
      })
      continue
    }

    if (!dirCreated) {
      await mkdir(attachmentsDir, { recursive: true })
      dirCreated = true
    }
    const path = join(attachmentsDir, fileName)
    const bytes = await downloadBytes(attachment.url, attachment.fileName)
    await writeFile(path, bytes)
    blocks.push({
      type: "resource_link",
      uri: `file://${path}`,
      name: attachment.fileName,
      mimeType: attachment.contentType ?? undefined,
      size: attachment.sizeBytes ?? undefined,
    })
  }

  return blocks
}
