import type { AssignedIssueLabel } from "@/app/query-contracts"
import { IconTagFilled } from "@tabler/icons-react"
import { Tooltip, TooltipContent, TooltipTrigger } from "@gentic/ui/tooltip"
import { cn } from "@gentic/ui/utils"

const visibleLabelCount = 3

export function IssueLabelChips({
  labels,
  selectedLabelIds,
  onLabelSelect,
}: {
  labels: AssignedIssueLabel[]
  selectedLabelIds: Set<string>
  onLabelSelect: (labelId: string) => void
}) {
  if (labels.length === 0) return null

  const visibleLabels = labels.slice(0, visibleLabelCount)
  const overflowLabels = labels.slice(visibleLabelCount)

  return (
    <div
      className="flex min-w-0 flex-wrap items-center gap-1.5"
      aria-label="Labels"
    >
      {visibleLabels.map((label) => (
        <button
          key={label.id}
          type="button"
          aria-label={`Filter by Label ${label.name}`}
          aria-pressed={selectedLabelIds.has(label.id)}
          className={cn(
            "inline-flex h-6 max-w-40 items-center gap-1.5 rounded-full border bg-background px-2 text-xs font-medium transition-[box-shadow,background-color] hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1 focus-visible:outline-none",
            selectedLabelIds.has(label.id) && "ring-2 ring-ring/40"
          )}
          style={{ borderColor: label.color }}
          onClick={(event) => {
            event.preventDefault()
            event.stopPropagation()
            onLabelSelect(label.id)
          }}
        >
          <IconTagFilled
            className="size-3.5 shrink-0"
            style={{ color: label.color }}
            aria-hidden="true"
          />
          <span className="truncate">{label.name}</span>
        </button>
      ))}
      {overflowLabels.length > 0 ? (
        <Tooltip>
          <TooltipTrigger asChild>
            <span
              tabIndex={0}
              aria-label={`${overflowLabels.length} more Labels. All Labels: ${labels.map((label) => label.name).join(", ")}`}
              className="inline-flex h-6 shrink-0 items-center rounded-full bg-muted px-2 text-xs font-medium text-muted-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
            >
              +{overflowLabels.length}
            </span>
          </TooltipTrigger>
          <TooltipContent side="top">
            {labels.map((label) => label.name).join(", ")}
          </TooltipContent>
        </Tooltip>
      ) : null}
    </div>
  )
}
