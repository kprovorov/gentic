import {
  IconAlertTriangle,
  IconArrowDown,
  IconArrowUp,
  IconMinus,
} from "@tabler/icons-react"

import {
  issuePriorityLabels,
  issuePriorityOptions,
  issuePriorityStyles,
  type IssuePriority,
} from "@gentic/validators/issues"

export { issuePriorityLabels, issuePriorityOptions, issuePriorityStyles }

export const issuePriorityIcons = {
  low: IconArrowDown,
  medium: IconMinus,
  high: IconArrowUp,
  urgent: IconAlertTriangle,
} satisfies Record<IssuePriority, typeof IconMinus>
