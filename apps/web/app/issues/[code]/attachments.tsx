"use client"

import type React from "react"
import { useMutation, useQueryClient } from "@tanstack/react-query"
import {
  IconDownload,
  IconPaperclip,
  IconTrash,
  IconUpload,
} from "@tabler/icons-react"

import { Button } from "@gentic/ui/button"

import { deleteAttachment, uploadAttachments } from "@/app/issues/actions"
import {
  AttachmentChip,
  formatAttachmentSize,
} from "@/app/issues/attachment-chip"
import { queryKeys } from "@/app/query-keys"

export type Attachment = {
  id: string
  fileName: string
  sizeBytes: number | null
  url: string | null
  thumbnailUrl: string | null
}

// Read-only attachment list, reused wherever attachments are shown alongside
// a message or request instead of being managed (uploaded/deleted).
export function AttachmentPreviews({
  attachments,
}: {
  attachments?: Attachment[]
}) {
  if (!attachments || attachments.length === 0) {
    return null
  }

  return (
    <div className="mt-2 flex max-w-full flex-wrap items-center gap-2">
      {attachments.map((attachment) => (
        <AttachmentChip
          key={attachment.id}
          fileName={attachment.fileName}
          sizeBytes={attachment.sizeBytes}
          thumbnailUrl={attachment.thumbnailUrl}
          action={
            attachment.url ? (
              <Button asChild variant="ghost" size="icon-xs">
                <a
                  href={attachment.url}
                  target="_blank"
                  rel="noreferrer"
                  download={attachment.fileName}
                >
                  <IconDownload />
                </a>
              </Button>
            ) : null
          }
        />
      ))}
    </div>
  )
}

// Durable Issue Attachments: files owned by the issue rather than by one chat
// turn. Uploading here writes no message and does not requeue or wake the
// agent, and the files survive an agent or conversation reset.
export function Attachments({
  issueId,
  attachments,
}: {
  issueId: string
  attachments: Attachment[]
}) {
  const queryClient = useQueryClient()
  const uploadMutation = useMutation({
    mutationFn: uploadAttachments,
    onSuccess: async () => {
      await queryClient.invalidateQueries({
        queryKey: queryKeys.issue(issueId),
      })
    },
  })

  function handleUpload(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    uploadMutation.mutate(new FormData(event.currentTarget))
    event.currentTarget.reset()
  }

  return (
    <div className="grid gap-4">
      {attachments.length === 0 ? (
        <p className="text-[12.5px] text-muted-foreground">
          No files attached. Files added here stay with the issue and are not
          sent to the agent as a message.
        </p>
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
        onSubmit={handleUpload}
        encType="multipart/form-data"
        className="flex flex-wrap items-center gap-2"
      >
        <input type="hidden" name="issue_id" value={issueId} />
        <input
          type="file"
          name="files"
          multiple
          aria-label="Attach files to this issue"
          className="min-w-0 text-sm text-muted-foreground file:mr-3 file:rounded-full file:border-0 file:bg-muted file:px-3 file:py-1.5 file:text-sm file:font-medium"
        />
        <Button
          type="submit"
          variant="outline"
          size="sm"
          disabled={uploadMutation.isPending}
        >
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
  attachment: Attachment
}) {
  const queryClient = useQueryClient()
  const mutation = useMutation({
    mutationFn: deleteAttachment,
    onSuccess: async () => {
      await queryClient.invalidateQueries({
        queryKey: queryKeys.issue(issueId),
      })
    },
  })

  function handleDelete() {
    if (mutation.isPending) {
      return
    }
    if (!window.confirm(`Delete "${attachment.fileName}"?`)) {
      return
    }

    const formData = new FormData()
    formData.set("id", attachment.id)
    formData.set("issue_id", issueId)
    mutation.mutate(formData)
  }

  return (
    <li className="flex items-center justify-between gap-3 rounded-lg border px-3 py-2 text-sm">
      <div className="flex min-w-0 items-center gap-2">
        {attachment.thumbnailUrl ? (
          // Supabase signs this URL with Image Transformation options.
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={attachment.thumbnailUrl}
            alt=""
            className="size-12 shrink-0 rounded-md border object-cover"
            loading="lazy"
          />
        ) : (
          <span className="flex size-12 shrink-0 items-center justify-center rounded-md border bg-muted text-muted-foreground">
            <IconPaperclip className="size-4" />
          </span>
        )}
        <div className="min-w-0">
          <p className="truncate">{attachment.fileName}</p>
          <p className="text-xs text-muted-foreground">
            {formatAttachmentSize(attachment.sizeBytes)}
          </p>
        </div>
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
          disabled={mutation.isPending}
        >
          <IconTrash />
        </Button>
      </div>
    </li>
  )
}
