"use client"

import { useMemo } from "react"
import { parseDiffFromFile } from "@pierre/diffs"
import { FileDiff } from "@pierre/diffs/react"

import { useTheme } from "@gentic/ui/theme-provider"

import type { ChatMessage } from "../issue-chat-state"

export type ToolCallDiff = {
  path: string
  oldText: string | null
  newText: string
}

// ACP tool calls report file edits as `{ type: "diff", path, oldText, newText }`
// content entries inside the structured chat event's `payload.content` array.
export function getToolCallDiffs(message: ChatMessage): ToolCallDiff[] {
  const content = message.payload?.content
  if (!Array.isArray(content)) {
    return []
  }

  const diffs: ToolCallDiff[] = []
  for (const entry of content) {
    if (!entry || typeof entry !== "object") {
      continue
    }
    const record = entry as Record<string, unknown>
    if (record.type !== "diff" || typeof record.path !== "string") {
      continue
    }
    if (typeof record.newText !== "string") {
      continue
    }
    diffs.push({
      path: record.path,
      oldText: typeof record.oldText === "string" ? record.oldText : null,
      newText: record.newText,
    })
  }
  return diffs
}

export function ToolCallDiffView({ diff }: { diff: ToolCallDiff }) {
  const { resolvedTheme } = useTheme()
  const fileDiff = useMemo(
    () =>
      parseDiffFromFile(
        { name: diff.path, contents: diff.oldText ?? "" },
        { name: diff.path, contents: diff.newText }
      ),
    [diff.path, diff.oldText, diff.newText]
  )

  return (
    <div className="max-h-96 max-w-full overflow-auto rounded-lg border text-xs">
      <FileDiff
        fileDiff={fileDiff}
        options={{ themeType: resolvedTheme === "dark" ? "dark" : "light" }}
      />
    </div>
  )
}
