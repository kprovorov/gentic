import type { LabelSnapshot } from "@gentic/validators/realtime"
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
        "inline-flex h-6 max-w-full shrink-0 items-center gap-1.5 rounded-full bg-background px-2 text-[12.5px] font-medium ring-1 ring-border",
        className
      )}
    >
      <span
        aria-hidden
        className="size-2.5 shrink-0 rounded-full"
        style={{ backgroundColor: label.color }}
      />
      <span className="min-w-0 truncate">{label.name}</span>
    </span>
  )
}
