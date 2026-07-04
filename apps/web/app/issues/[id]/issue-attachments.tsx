"use client"

import { useTransition } from "react"
import {
  IconDownload,
  IconPaperclip,
  IconTrash,
  IconUpload,
} from "@tabler/icons-react"

import { Button } from "@gentic/ui/button"

import {
  deleteIssueAttachment,
  uploadIssueAttachments,
} from "@/app/issues/actions"

export type IssueAttachment = {
  id: string
  fileName: string
  sizeBytes: number | null
  url: string | null
}

function formatSize(bytes: number | null): string {
  if (!bytes) {
    return ""
  }
  if (bytes < 1024) {
    return `${bytes} B`
  }
  if (bytes < 1024 * 1024) {
    return `${(bytes / 1024).toFixed(1)} KB`
  }
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

export function IssueAttachments({
  issueId,
  attachments,
}: {
  issueId: string
  attachments: IssueAttachment[]
}) {
  return (
    <div className="grid gap-4">
      {attachments.length === 0 ? (
        <p className="text-sm text-muted-foreground">No files attached.</p>
      ) : (
        <ul className="grid gap-2">
          {attachments.map((attachment) => (
            <AttachmentRow
              key={attachment.id}
              issueId={issueId}
              attachment={attachment}
            />
          ))}
        </ul>
      )}

      <form
        action={uploadIssueAttachments}
        encType="multipart/form-data"
        className="flex flex-wrap items-center gap-2"
      >
        <input type="hidden" name="issue_id" value={issueId} />
        <input
          type="file"
          name="files"
          multiple
          className="text-sm text-muted-foreground file:mr-3 file:rounded-full file:border-0 file:bg-muted file:px-3 file:py-1.5 file:text-sm file:font-medium"
        />
        <Button type="submit" variant="outline" size="sm">
          <IconUpload />
          Upload
        </Button>
      </form>
    </div>
  )
}

function AttachmentRow({
  issueId,
  attachment,
}: {
  issueId: string
  attachment: IssueAttachment
}) {
  const [isPending, startTransition] = useTransition()

  function handleDelete() {
    if (isPending) {
      return
    }
    if (!window.confirm(`Delete "${attachment.fileName}"?`)) {
      return
    }

    const formData = new FormData()
    formData.set("id", attachment.id)
    formData.set("issue_id", issueId)
    startTransition(() => {
      void deleteIssueAttachment(formData)
    })
  }

  return (
    <li className="flex items-center justify-between gap-3 rounded-lg border px-3 py-2 text-sm">
      <div className="flex min-w-0 items-center gap-2">
        <IconPaperclip className="size-4 shrink-0 text-muted-foreground" />
        <span className="truncate">{attachment.fileName}</span>
        <span className="shrink-0 text-xs text-muted-foreground">
          {formatSize(attachment.sizeBytes)}
        </span>
      </div>
      <div className="flex shrink-0 items-center gap-1">
        {attachment.url ? (
          <Button asChild variant="ghost" size="icon-sm">
            <a
              href={attachment.url}
              target="_blank"
              rel="noreferrer"
              download={attachment.fileName}
            >
              <IconDownload />
            </a>
          </Button>
        ) : null}
        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          onClick={handleDelete}
          disabled={isPending}
        >
          <IconTrash />
        </Button>
      </div>
    </li>
  )
}
