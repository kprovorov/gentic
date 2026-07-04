import { mkdir, writeFile } from "node:fs/promises"
import { join } from "node:path"

import type { AgentApi } from "./api"

const ATTACHMENTS_DIR = ".gentic/attachments"

function sanitizeFileName(name: string, index: number): string {
  const base = name.split(/[/\\]/).pop() || `file-${index}`
  const cleaned = base.replace(/[^a-zA-Z0-9._-]/g, "_")
  return cleaned || `file-${index}`
}

/**
 * Downloads an issue's attachments into the cloned repo so Claude Code can
 * read them like any other file, and returns a note pointing at their local
 * paths to append to the next prompt. Empty string when there are none.
 */
export async function downloadAttachments(
  api: AgentApi,
  issueId: string,
  cwd: string
): Promise<string> {
  const attachments = await api.fetchAttachments(issueId)
  if (attachments.length === 0) {
    return ""
  }

  await mkdir(join(cwd, ATTACHMENTS_DIR), { recursive: true })

  const paths: string[] = []
  for (const [index, attachment] of attachments.entries()) {
    const response = await fetch(attachment.url)
    if (!response.ok) {
      throw new Error(
        `Failed to download attachment "${attachment.fileName}": ${response.status}`
      )
    }
    const bytes = new Uint8Array(await response.arrayBuffer())
    const relativePath = join(
      ATTACHMENTS_DIR,
      sanitizeFileName(attachment.fileName, index)
    )
    await writeFile(join(cwd, relativePath), bytes)
    paths.push(relativePath)
  }

  return `\n\nAttached files (available at these paths in the repo):\n${paths
    .map((path) => `- ${path}`)
    .join("\n")}`
}
