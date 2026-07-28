import type { Attachment } from "../attachments"

export function createOptimisticAttachments(
  files: File[],
  onLocalThumbnailUrl?: (url: string) => void
): Attachment[] {
  return files
    .filter((file) => file.size > 0)
    .map((file) => {
      const thumbnailUrl = createLocalImageThumbnailUrl(file)
      if (thumbnailUrl) {
        onLocalThumbnailUrl?.(thumbnailUrl)
      }

      return {
        id: `optimistic-${crypto.randomUUID()}`,
        fileName: file.name,
        sizeBytes: file.size,
        url: null,
        thumbnailUrl,
      }
    })
}

function createLocalImageThumbnailUrl(file: File): string | null {
  if (!file.type.startsWith("image/")) {
    return null
  }
  if (typeof URL.createObjectURL !== "function") {
    return null
  }

  return URL.createObjectURL(file)
}

export function isLocalThumbnailUrl(url: string | null): url is string {
  return url?.startsWith("blob:") ?? false
}
