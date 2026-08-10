import type { LabelSnapshot } from "@gentic/validators/realtime"
import { IconTagFilled } from "@tabler/icons-react"
import { cn } from "@gentic/ui/utils"

export function IssueLabelChip({
  label,
  className,
}: {
  label: LabelSnapshot
  className?: string
}) {
  return (
    <span
      className={cn(
        "inline-flex h-6 max-w-full shrink-0 items-center gap-1.5 rounded-full bg-muted px-2 text-[12.5px] font-medium text-muted-foreground",
        className
      )}
    >
      <IconTagFilled
        aria-hidden
        className="size-3.5 shrink-0"
        style={{ color: label.color }}
      />
      <span className="min-w-0 truncate">{label.name}</span>
    </span>
  )
}
