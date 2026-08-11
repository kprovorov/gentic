"use client"

import type React from "react"
import { useEffect, useRef, useState } from "react"
import { IconPaperclip, IconTrash } from "@tabler/icons-react"

import { Button } from "@gentic/ui/button"
import { cn } from "@gentic/ui/utils"

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

export function AttachmentPromptField({
  id,
  name,
  value,
  onChange,
  rows,
  placeholder,
  required,
  disabled,
  className,
  textareaClassName,
  files,
  onFilesChange,
  onKeyDown,
  metaRow,
  footerStart,
  footerEnd,
  variant = "boxed",
}: {
  id?: string
  name?: string
  value: string
  onChange: (value: string) => void
  rows: number
  placeholder?: string
  required?: boolean
  disabled?: boolean
  className?: string
  textareaClassName?: string
  files?: File[]
  onFilesChange?: (files: File[]) => void
  onKeyDown?: React.KeyboardEventHandler<HTMLTextAreaElement>
  // Rendered as its own row between the textarea and the action row. Used by
  // the new-issue composer to stack option pills above the attach/submit bar.
  metaRow?: React.ReactNode
  footerStart?: React.ReactNode
  footerEnd?: React.ReactNode
  // "bare" drops the container's border/background so the field blends into a
  // surrounding surface (e.g. the New Issue dialog, which is the card itself).
  variant?: "boxed" | "bare"
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

  function handleDrop(event: React.DragEvent<HTMLDivElement>) {
    event.preventDefault()
    setIsDragging(false)
    addFiles(event.dataTransfer.files)
  }

  const isBare = variant === "bare"

  return (
    <div
      className={cn(
        "relative transition-[color,box-shadow,background-color]",
        isBare
          ? "rounded-2xl"
          : "rounded-[22px] border border-transparent bg-input/50 focus-within:border-ring focus-within:ring-3 focus-within:ring-ring/30",
        isDragging &&
          (isBare ? "ring-3 ring-ring/30" : "border-ring ring-3 ring-ring/30"),
        className
      )}
      onDragEnter={(event) => {
        event.preventDefault()
        setIsDragging(true)
      }}
      onDragOver={(event) => {
        event.preventDefault()
        setIsDragging(true)
      }}
      onDragLeave={(event) => {
        const nextTarget = event.relatedTarget
        if (
          !(nextTarget instanceof Node) ||
          !event.currentTarget.contains(nextTarget)
        ) {
          setIsDragging(false)
        }
      }}
      onDrop={handleDrop}
    >
      <textarea
        id={id}
        name={name}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        onKeyDown={onKeyDown}
        rows={rows}
        placeholder={placeholder}
        required={required}
        disabled={disabled}
        className={cn(
          "w-full resize-y bg-transparent text-base outline-none placeholder:text-muted-foreground disabled:pointer-events-none disabled:opacity-50 md:text-sm",
          isBare ? "px-1 pt-1 pb-2" : "px-4 pt-3 pb-1",
          textareaClassName
        )}
      />

      {selectedFiles.length > 0 ? (
        <ul
          className={cn(
            "flex min-w-0 flex-wrap gap-2",
            isBare ? "px-1 pb-2" : "px-3 pb-2"
          )}
        >
          {selectedFiles.map((file, index) => (
            <li
              key={`${file.name}-${file.size}-${file.lastModified}`}
              className="flex max-w-full min-w-0"
            >
              <PendingAttachmentChip
                file={file}
                disabled={disabled}
                onRemove={() => removeFile(index)}
              />
            </li>
          ))}
        </ul>
      ) : null}

      {metaRow ? (
        <div
          className={cn(
            "flex min-w-0 flex-wrap items-center gap-2",
            isBare ? "px-1 pb-2" : "px-3 pb-1"
          )}
        >
          {metaRow}
        </div>
      ) : null}

      <div
        className={cn(
          "flex min-w-0 flex-wrap items-center gap-2 overflow-hidden",
          isBare
            ? "px-0.5"
            : "border-t border-border/50 pt-1.5 pr-2.5 pb-2 pl-3"
        )}
      >
        {/* Deliberately unnamed: the selection lives in `selectedFiles` and
            the bytes are uploaded straight to Storage, so a file input that
            could ride along in a form post would only be a way to blow the
            Server Action body limit. Clearing `value` lets the same file be
            re-picked after it was removed from the list. */}
        <input
          ref={fileInputRef}
          type="file"
          multiple
          className="sr-only"
          tabIndex={-1}
          onChange={(event) => {
            addFiles(event.currentTarget.files)
            event.currentTarget.value = ""
          }}
        />
        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          disabled={disabled}
          onClick={() => fileInputRef.current?.click()}
          aria-label="Attach files"
          className="rounded-full text-muted-foreground hover:bg-muted hover:text-foreground"
        >
          <IconPaperclip />
        </Button>
        {footerStart}
        <span className="min-h-8 min-w-0 flex-1" aria-hidden="true" />
        {footerEnd}
      </div>
    </div>
  )
}

function PendingAttachmentChip({
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
