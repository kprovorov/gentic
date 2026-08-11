"use client"

import type React from "react"
import { useEffect, useRef, useState } from "react"
import { IconPaperclip, IconTrash } from "@tabler/icons-react"

import { Button } from "@gentic/ui/button"
import { cn } from "@gentic/ui/utils"

const MAX_ATTACHMENT_BYTES = 25 * 1024 * 1024

function formatSize(bytes: number): string {
  if (bytes < 1024) {
    return `${bytes} B`
  }
  if (bytes < 1024 * 1024) {
    return `${(bytes / 1024).toFixed(1)} KB`
  }
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

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
  fileInputName = "files",
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
  fileInputName?: string
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

  useEffect(() => {
    const input = fileInputRef.current
    if (!input) {
      return
    }

    const transfer = new DataTransfer()
    for (const file of selectedFiles) {
      transfer.items.add(file)
    }
    try {
      input.files = transfer.files
    } catch {
      // jsdom cannot synthesize a real FileList; the controlled file state
      // remains authoritative for retries and client-side form construction.
    }
  }, [selectedFiles])

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
        <input
          ref={fileInputRef}
          type="file"
          name={fileInputName}
          multiple
          className="sr-only"
          tabIndex={-1}
          onChange={(event) => addFiles(event.currentTarget.files)}
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
        {selectedFiles.length === 0 ? (
          <span className="min-h-8 min-w-0 flex-1" aria-hidden="true" />
        ) : (
          <ul className="order-last flex min-w-0 basis-full flex-wrap gap-1.5 sm:order-none sm:basis-auto sm:flex-1">
            {selectedFiles.map((file, index) => (
              <li
                key={`${file.name}-${file.size}-${file.lastModified}`}
                className={cn(
                  "flex max-w-full min-w-0 items-center gap-1.5 rounded-full bg-background px-2.5 py-1 text-xs ring-1 ring-border",
                  file.size > MAX_ATTACHMENT_BYTES && "text-destructive"
                )}
              >
                <IconPaperclip className="size-3 shrink-0" />
                <span className="min-w-0 flex-1 truncate sm:max-w-48">
                  {file.name}
                </span>
                <span className="shrink-0 text-muted-foreground">
                  {formatSize(file.size)}
                </span>
                <button
                  type="button"
                  className="rounded-full p-0.5 text-muted-foreground hover:bg-muted hover:text-foreground"
                  onClick={() => removeFile(index)}
                  aria-label={`Remove ${file.name}`}
                  disabled={disabled}
                >
                  <IconTrash className="size-3" />
                </button>
              </li>
            ))}
          </ul>
        )}
        {footerEnd}
      </div>
    </div>
  )
}
