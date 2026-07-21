"use client"

import type React from "react"
import { useEffect, useRef, useState } from "react"
import { IconPaperclip, IconTrash, IconUpload } from "@tabler/icons-react"

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

  return (
    <div
      className={cn(
        "relative rounded-3xl border border-transparent bg-input/50 transition-[color,box-shadow,background-color] focus-within:border-ring focus-within:ring-3 focus-within:ring-ring/30",
        isDragging && "border-ring ring-3 ring-ring/30",
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
          "w-full resize-y bg-transparent px-4 py-3 text-base outline-none placeholder:text-muted-foreground disabled:pointer-events-none disabled:opacity-50 md:text-sm",
          textareaClassName
        )}
      />

      <div className="flex flex-wrap items-center gap-2 border-t border-border/50 px-3 py-2">
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
        >
          <IconPaperclip />
        </Button>
        {selectedFiles.length === 0 ? (
          <span className="flex min-h-8 items-center gap-1 text-xs text-muted-foreground">
            <IconUpload className="size-3.5" />
            Drop files here or attach
          </span>
        ) : (
          <ul className="flex min-w-0 flex-1 flex-wrap gap-1.5">
            {selectedFiles.map((file, index) => (
              <li
                key={`${file.name}-${file.size}-${file.lastModified}`}
                className={cn(
                  "flex max-w-full items-center gap-1.5 rounded-full bg-background px-2.5 py-1 text-xs ring-1 ring-border",
                  file.size > MAX_ATTACHMENT_BYTES && "text-destructive"
                )}
              >
                <IconPaperclip className="size-3 shrink-0" />
                <span className="max-w-48 truncate">{file.name}</span>
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
      </div>
    </div>
  )
}
