"use client"

import type React from "react"
import { useRef } from "react"
import { useMutation, useQueryClient } from "@tanstack/react-query"
import {
  IconDownload,
  IconPaperclip,
  IconTrash,
  IconUpload,
} from "@tabler/icons-react"

import { useSupabaseClient } from "@gentic/supabase/client"
import { Button } from "@gentic/ui/button"

import {
  deleteAttachment,
  finishAttachmentUploads,
  startAttachmentUploads,
} from "@/app/issues/actions"
import {
  AttachmentChip,
  formatAttachmentSize,
} from "@/app/issues/attachment-chip"
import {
  appendAttachmentDescriptors,
  appendAttachmentIds,
  uploadAttachmentFiles,
} from "@/app/issues/attachment-uploads"
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

// Every file the issue holds, whichever way it arrived: the durable Issue
// Attachments it owns, then the files sent through the chat composer, so this
// section answers "what has been attached here?" without scrolling the
// transcript.
//
// Only the issue's own files are managed here. Uploading writes no message and
// does not requeue or wake the agent, and those files survive an agent or
// conversation reset. Chat files are listed read-only: they were delivered as
// part of one prompt turn, and deleting one from here would quietly hollow out
// a message the transcript still shows as sent.
export function Attachments({
  issueId,
  attachments,
  messageAttachments,
}: {
  issueId: string
  attachments: Attachment[]
  messageAttachments: Attachment[]
}) {
  const queryClient = useQueryClient()
  const supabase = useSupabaseClient()
  // Read straight off the input rather than through `new FormData(form)`: the
  // bytes go to Storage, never into an action payload, so the form is only
  // here for its submit semantics.
  const fileInputRef = useRef<HTMLInputElement>(null)
  const uploadMutation = useMutation({
    // Bytes go browser → Storage under a signed ticket; the Server Actions
    // only reserve the rows and then publish them, since an action body is
    // capped well below the 25MB a single attachment may be.
    mutationFn: async (files: File[]) => {
      const start = new FormData()
      start.set("issue_id", issueId)
      appendAttachmentDescriptors(start, files)

      const { uploads } = await startAttachmentUploads(start)
      const attachmentIds = await uploadAttachmentFiles(
        supabase,
        uploads,
        files
      )

      const finish = new FormData()
      finish.set("issue_id", issueId)
      appendAttachmentIds(finish, attachmentIds)
      await finishAttachmentUploads(finish)
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({
        queryKey: queryKeys.issue(issueId),
      })
    },
  })

  function handleUpload(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const files = Array.from(fileInputRef.current?.files ?? []).filter(
      (file) => file.size > 0
    )

    if (files.length > 0) {
      uploadMutation.mutate(files)
    }
    event.currentTarget.reset()
  }

  return (
    <div className="grid gap-4">
      {attachments.length === 0 && messageAttachments.length === 0 ? (
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
          {messageAttachments.map((attachment) => (
            <AttachmentRow
              key={attachment.id}
              issueId={issueId}
              attachment={attachment}
              sentInChat
            />
          ))}
        </ul>
      )}

      <form
        onSubmit={handleUpload}
        encType="multipart/form-data"
        className="flex flex-wrap items-center gap-2"
      >
        <input
          ref={fileInputRef}
          type="file"
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
  sentInChat = false,
}: {
  issueId: string
  attachment: Attachment
  sentInChat?: boolean
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
            className="size-12 shrink-0 rounded-md border bg-muted object-contain"
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
            {sentInChat ? " · Sent in chat" : null}
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
              aria-label={`Download ${attachment.fileName}`}
            >
              <IconDownload />
            </a>
          </Button>
        ) : null}
        {sentInChat ? null : (
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            aria-label={`Delete ${attachment.fileName}`}
            onClick={handleDelete}
            disabled={mutation.isPending}
          >
            <IconTrash />
          </Button>
        )}
      </div>
    </li>
  )
}
