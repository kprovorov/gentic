import type React from "react"
import { IconFileText, IconPhoto } from "@tabler/icons-react"

import { cn } from "@gentic/ui/utils"

export function formatAttachmentSize(bytes: number | null): string {
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

function fileExtension(fileName: string): string {
  const dotIndex = fileName.lastIndexOf(".")
  return dotIndex === -1 ? "" : fileName.slice(dotIndex + 1).toUpperCase()
}

export function isImageFileName(fileName: string): boolean {
  return /\.(png|jpe?g|gif|webp|svg)$/i.test(fileName)
}

// The one attachment chip: thumbnail, file name and "TYPE · SIZE". Shared by
// the read-only previews on sent messages and by the composer's pending files
// so an attachment looks the same before and after it is sent.
export function AttachmentChip({
  fileName,
  sizeBytes,
  thumbnailUrl,
  invalid,
  action,
  className,
}: {
  fileName: string
  sizeBytes: number | null
  thumbnailUrl?: string | null
  // Renders the chip in the destructive palette, e.g. an oversized file that
  // will be rejected on upload.
  invalid?: boolean
  // Trailing control such as download or remove.
  action?: React.ReactNode
  className?: string
}) {
  const meta = [fileExtension(fileName), formatAttachmentSize(sizeBytes)]
    .filter(Boolean)
    .join(" · ")

  return (
    <span
      className={cn(
        // The outline is a border, not a ring: a ring paints *outside* the
        // border box, and a chip is routinely the last thing inside a scroll
        // container (the request body, a chat bubble), where its bottom edge
        // sits flush against the clip rect and the ring's bottom line gets
        // shaved off — the chip renders with three sides and no floor.
        "flex max-w-full items-center gap-2.5 rounded-2xl border border-border bg-background p-1.5 text-xs",
        invalid && "border-destructive text-destructive",
        className
      )}
    >
      {/* The preview always sits in the same tinted tile as the file icon it
          replaces, and the image is letterboxed inside it rather than cropped
          to fill it: a square crop of a phone screenshot is a blank slice of
          its middle, and with nothing marking the tile's edges that slice reads
          as broken chrome instead of a picture. */}
      <span className="flex size-[34px] shrink-0 items-center justify-center overflow-hidden rounded-[9px] bg-muted text-muted-foreground">
        {thumbnailUrl ? (
          // Supabase signs this URL with Image Transformation options; pending
          // composer files pass a local object URL.
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={thumbnailUrl}
            alt=""
            className="size-full object-contain"
            loading="lazy"
          />
        ) : isImageFileName(fileName) ? (
          <IconPhoto className="size-4" />
        ) : (
          <IconFileText className="size-4" />
        )}
      </span>
      <span className="grid min-w-0 pr-0.5 leading-[1.35]">
        <span className="min-w-0 truncate font-medium">{fileName}</span>
        {meta ? (
          <span
            className={cn(
              "text-[11px]",
              invalid ? "text-destructive" : "text-muted-foreground"
            )}
          >
            {meta}
          </span>
        ) : null}
      </span>
      {action}
    </span>
  )
}
