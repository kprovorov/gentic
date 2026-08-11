import type { LabelSnapshot } from "@gentic/validators/realtime"
import { IconTagFilled } from "@tabler/icons-react"
import { Pill, PillLabel } from "@gentic/ui/pill"

// The inside of a label pill, shared so the clickable filter chips in
// IssueLabelChips look identical to the read-only ones.
export function IssueLabelChipContent({ label }: { label: LabelSnapshot }) {
  return (
    <>
      <IconTagFilled aria-hidden style={{ color: label.color }} />
      <PillLabel>{label.name}</PillLabel>
    </>
  )
}

export function IssueLabelChip({
  label,
  className,
}: {
  label: LabelSnapshot
  className?: string
}) {
  return (
    <Pill className={className}>
      <IssueLabelChipContent label={label} />
    </Pill>
  )
}
