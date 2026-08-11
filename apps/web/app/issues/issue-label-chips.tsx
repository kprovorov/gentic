import type { AssignedIssueLabel } from "@/app/query-contracts"
import { Pill, PillButton } from "@gentic/ui/pill"
import { Tooltip, TooltipContent, TooltipTrigger } from "@gentic/ui/tooltip"

import { IssueLabelChipContent } from "./issue-label-chip"

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
        <PillButton
          key={label.id}
          aria-label={`Filter by Label ${label.name}`}
          aria-pressed={selectedLabelIds.has(label.id)}
          selected={selectedLabelIds.has(label.id)}
          className="max-w-40"
          onClick={(event) => {
            event.preventDefault()
            event.stopPropagation()
            onLabelSelect(label.id)
          }}
        >
          <IssueLabelChipContent label={label} />
        </PillButton>
      ))}
      {overflowLabels.length > 0 ? (
        <Tooltip>
          <TooltipTrigger asChild>
            <Pill
              tabIndex={0}
              aria-label={`${overflowLabels.length} more Labels. All Labels: ${labels.map((label) => label.name).join(", ")}`}
            >
              +{overflowLabels.length}
            </Pill>
          </TooltipTrigger>
          <TooltipContent side="top">
            {labels.map((label) => label.name).join(", ")}
          </TooltipContent>
        </Tooltip>
      ) : null}
    </div>
  )
}
