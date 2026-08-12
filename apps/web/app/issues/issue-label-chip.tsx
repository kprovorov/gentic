import type { LabelSnapshot } from "@gentic/validators/realtime"
import { IconTagFilled, IconX } from "@tabler/icons-react"
import { cn } from "@gentic/ui/utils"

import { issueBadgeClassName } from "./issue-badge-styles"

export function IssueLabelChip({
  label,
  className,
  onRemove,
}: {
  label: LabelSnapshot
  className?: string
  // Turns the chip into an editable one by appending a remove button. Used by
  // the create-issue composer, where the chips are the label selection itself.
  onRemove?: () => void
}) {
  return (
    <span
      className={cn(
        issueBadgeClassName,
        "max-w-full gap-1.5 text-[12.5px]",
        onRemove && "pr-1",
        className
      )}
    >
      <IconTagFilled
        aria-hidden
        className="size-3.5 shrink-0"
        style={{ color: label.color }}
      />
      <span className="min-w-0 truncate">{label.name}</span>
      {onRemove ? (
        <button
          type="button"
          aria-label={`Remove ${label.name} label`}
          onClick={onRemove}
          className="flex size-4 shrink-0 items-center justify-center rounded-full hover:bg-foreground/10 hover:text-foreground"
        >
          <IconX className="size-3" />
        </button>
      ) : null}
    </span>
  )
}
