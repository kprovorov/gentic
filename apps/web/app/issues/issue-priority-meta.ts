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

// The priority pill itself stays neutral, so urgency is carried by the icon's
// colour alone. Shared by every surface that shows a priority.
export const priorityIconStyles: Record<IssuePriority, string> = {
  low: "text-gray-600 dark:text-gray-300",
  medium: "text-blue-600 dark:text-blue-300",
  high: "text-amber-600 dark:text-amber-300",
  urgent: "text-red-600 dark:text-red-300",
}
