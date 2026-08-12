"use client"

import type React from "react"
import { useEffect, useRef, useState } from "react"
import { IconTrash } from "@tabler/icons-react"

import { Button } from "@gentic/ui/button"

import { AttachmentChip } from "./attachment-chip"

const MAX_ATTACHMENT_BYTES = 25 * 1024 * 1024

function mergeFiles(current: File[], incoming: File[]) {
  const next = [...current]
  for (const file of incoming) {
    const duplicate = next.some(
      (existing) =>
        existing.name === file.name &&
        existing.size === file.size &&
        existing.lastModified === file.lastModified
    )
    if (!duplicate) {
      next.push(file)
    }
  }
  return next
}

// The attachment mechanics shared by the two composer layouts — the stacked
// AttachmentPromptField and the collapsible chat MessageComposer — so only the
// arrangement of the textarea, chips and buttons differs between them.
export function useAttachmentSelection({
  files,
  onFilesChange,
}: {
  files?: File[]
  onFilesChange?: (files: File[]) => void
}) {
  const fileInputRef = useRef<HTMLInputElement>(null)
  const [internalFiles, setInternalFiles] = useState<File[]>([])
  const [isDragging, setIsDragging] = useState(false)
  const selectedFiles = files ?? internalFiles

  function updateFiles(next: File[]) {
    if (files === undefined) {
      setInternalFiles(next)
    }
    onFilesChange?.(next)
  }

  function addFiles(fileList: FileList | null) {
    if (!fileList) {
      return
    }
    updateFiles(mergeFiles(selectedFiles, Array.from(fileList)))
  }

  function removeFile(index: number) {
    updateFiles(selectedFiles.filter((_, fileIndex) => fileIndex !== index))
  }

  // Reset the selection on the way *into* the picker, never on the way out: a
  // file picked on iOS is backed by a temporary file WebKit only materializes
  // when the bytes are read, and clearing the input's selection releases it, so
  // resetting `value` from `onChange` leaves the kept `File`s unreadable — no
  // preview, and a failing upload. Clearing here still lets the same file be
  // re-picked after it was removed from the list.
  function openFilePicker() {
    const input = fileInputRef.current
    if (!input) {
      return
    }
    input.value = ""
    input.click()
  }

  return {
    selectedFiles,
    isDragging,
    removeFile,
    openFilePicker,
    // Deliberately unnamed: the selection lives in `selectedFiles` and the
    // bytes are uploaded straight to Storage, so a file input that could ride
    // along in a form post would only be a way to blow the Server Action body
    // limit.
    fileInputProps: {
      ref: fileInputRef,
      type: "file" as const,
      multiple: true,
      className: "sr-only",
      tabIndex: -1,
      onChange: (event: React.ChangeEvent<HTMLInputElement>) =>
        addFiles(event.currentTarget.files),
    },
    dropTargetProps: {
      onDragEnter: (event: React.DragEvent<HTMLElement>) => {
        event.preventDefault()
        setIsDragging(true)
      },
      onDragOver: (event: React.DragEvent<HTMLElement>) => {
        event.preventDefault()
        setIsDragging(true)
      },
      onDragLeave: (event: React.DragEvent<HTMLElement>) => {
        const nextTarget = event.relatedTarget
        if (
          !(nextTarget instanceof Node) ||
          !event.currentTarget.contains(nextTarget)
        ) {
          setIsDragging(false)
        }
      },
      onDrop: (event: React.DragEvent<HTMLElement>) => {
        event.preventDefault()
        setIsDragging(false)
        addFiles(event.dataTransfer.files)
      },
    },
  }
}

export function PendingAttachmentChip({
  file,
  disabled,
  onRemove,
}: {
  file: File
  disabled?: boolean
  onRemove: () => void
}) {
  const previewUrl = useImagePreviewUrl(file)

  return (
    <AttachmentChip
      fileName={file.name}
      sizeBytes={file.size}
      thumbnailUrl={previewUrl}
      invalid={file.size > MAX_ATTACHMENT_BYTES}
      className="min-w-0"
      action={
        <Button
          type="button"
          variant="ghost"
          size="icon-xs"
          onClick={onRemove}
          aria-label={`Remove ${file.name}`}
          disabled={disabled}
        >
          <IconTrash />
        </Button>
      }
    />
  )
}

// Previews an image the user just picked, before it has any remote URL. Each
// chip is keyed by file identity, so the URL is created once on mount and
// revoked when the file is removed or sent.
function useImagePreviewUrl(file: File): string | null {
  const [previewUrl] = useState(() =>
    // jsdom (and any environment without blob URLs) simply gets the icon.
    file.type.startsWith("image/") && URL.createObjectURL
      ? URL.createObjectURL(file)
      : null
  )

  useEffect(() => {
    if (!previewUrl) {
      return
    }
    return () => URL.revokeObjectURL(previewUrl)
  }, [previewUrl])

  return previewUrl
}
