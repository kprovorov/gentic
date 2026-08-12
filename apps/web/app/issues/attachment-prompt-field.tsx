"use client"

import type React from "react"
import { IconPaperclip } from "@tabler/icons-react"

import { Button } from "@gentic/ui/button"
import { cn } from "@gentic/ui/utils"

import {
  PendingAttachmentChip,
  useAttachmentSelection,
} from "./attachment-selection"

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
  const {
    selectedFiles,
    isDragging,
    removeFile,
    openFilePicker,
    fileInputProps,
    dropTargetProps,
  } = useAttachmentSelection({ files, onFilesChange })

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
      {...dropTargetProps}
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
        <input {...fileInputProps} />
        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          disabled={disabled}
          onClick={() => openFilePicker()}
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
