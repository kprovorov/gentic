import {
  IconAlertCircle,
  IconAlertOctagon,
  IconAlertTriangle,
  IconCircleCheck,
  IconCircleDashed,
  IconCircleX,
  IconDownload,
  IconEye,
  IconFlask,
  IconGitMerge,
  IconLoader2,
  IconMessage2,
  IconMessageQuestion,
  IconPencil,
  IconPlayerPause,
  IconRobot,
  IconRocket,
  IconShieldCheck,
  IconThumbUp,
  type IconProps,
} from "@tabler/icons-react"
import type { ComponentType } from "react"

import { cn } from "@gentic/ui/utils"
import { issueStatusSchema, type IssueStatus } from "@gentic/validators/issues"

// The single source of truth for how a status is presented, so the issues
// table, the status dropdowns, and the timeline stay visually consistent.
export const statusLabels: Record<IssueStatus, string> = {
  draft: "Draft",
  todo: "To do",
  queued: "Queued",
  held: "On hold",
  "in-progress": "In progress",
  "waiting-for-input": "Waiting for input",
  testing: "Testing",
  "tests-failed": "Tests failed",
  "ready-for-review": "Ready for review",
  reviewing: "Reviewing",
  "changes-requested": "Changes requested",
  approved: "Approved",
  merged: "Merged",
  deploying: "Deploying",
  "deploy-failed": "Deploy failed",
  validating: "Validating",
  "run-failed": "Run failed",
  completed: "Completed",
  cancelled: "Cancelled",
}

export const statusStyles: Record<IssueStatus, string> = {
  draft: "bg-muted text-muted-foreground",
  todo: "bg-muted text-muted-foreground",
  queued: "bg-muted text-muted-foreground",
  held: "bg-muted text-muted-foreground",
  "in-progress": "bg-muted text-muted-foreground",
  "waiting-for-input": "bg-muted text-muted-foreground",
  testing: "bg-muted text-muted-foreground",
  "tests-failed": "bg-muted text-muted-foreground",
  "ready-for-review": "bg-muted text-muted-foreground",
  reviewing: "bg-muted text-muted-foreground",
  "changes-requested": "bg-muted text-muted-foreground",
  approved: "bg-muted text-muted-foreground",
  merged: "bg-muted text-muted-foreground",
  deploying: "bg-muted text-muted-foreground",
  "deploy-failed": "bg-muted text-muted-foreground",
  validating: "bg-muted text-muted-foreground",
  "run-failed": "bg-muted text-muted-foreground",
  completed: "bg-muted text-muted-foreground",
  cancelled: "bg-muted text-muted-foreground",
}

export const statusIconStyles: Record<IssueStatus, string> = {
  draft: "text-muted-foreground",
  todo: "text-muted-foreground",
  queued: "text-primary",
  held: "text-amber-600 dark:text-amber-300",
  "in-progress": "text-blue-600 dark:text-blue-300",
  "waiting-for-input": "text-amber-600 dark:text-amber-300",
  testing: "text-sky-600 dark:text-sky-300",
  "tests-failed": "text-red-600 dark:text-red-300",
  "ready-for-review": "text-violet-600 dark:text-violet-300",
  reviewing: "text-fuchsia-600 dark:text-fuchsia-300",
  "changes-requested": "text-orange-600 dark:text-orange-300",
  approved: "text-teal-600 dark:text-teal-300",
  merged: "text-indigo-600 dark:text-indigo-300",
  deploying: "text-blue-600 dark:text-blue-300",
  "deploy-failed": "text-rose-600 dark:text-rose-300",
  validating: "text-cyan-600 dark:text-cyan-300",
  "run-failed": "text-destructive",
  completed: "text-emerald-600 dark:text-emerald-300",
  cancelled: "text-muted-foreground",
}

// Broader than a Tabler icon so a status can supply its own wrapper, like the
// spinning in-progress icon below.
type StatusIcon = ComponentType<IconProps>

// In progress is the one status where a run is actively working, so its icon
// spins instead of sitting still. Callers render it like any other status icon,
// which keeps the animation wherever the icon shows up.
function IconInProgress({ className, ...props }: IconProps) {
  return (
    <IconLoader2
      className={cn("animate-spin motion-reduce:animate-none", className)}
      {...props}
    />
  )
}

export const statusIcons: Record<IssueStatus, StatusIcon> = {
  draft: IconPencil,
  todo: IconCircleDashed,
  queued: IconDownload,
  held: IconPlayerPause,
  "in-progress": IconInProgress,
  "waiting-for-input": IconMessageQuestion,
  testing: IconFlask,
  "tests-failed": IconAlertTriangle,
  "ready-for-review": IconEye,
  reviewing: IconRobot,
  "changes-requested": IconMessage2,
  approved: IconThumbUp,
  merged: IconGitMerge,
  deploying: IconRocket,
  "deploy-failed": IconAlertOctagon,
  validating: IconShieldCheck,
  "run-failed": IconAlertCircle,
  completed: IconCircleCheck,
  cancelled: IconCircleX,
}

// Ranks statuses by how much attention they need, so grouped and sorted issue
// lists surface blocked or failing work above settled work.
export const statusOrder: Record<IssueStatus, number> = {
  "waiting-for-input": 0,
  "tests-failed": 1,
  "changes-requested": 2,
  "deploy-failed": 3,
  "run-failed": 4,
  held: 5,
  "in-progress": 6,
  queued: 7,
  testing: 8,
  reviewing: 9,
  validating: 10,
  deploying: 11,
  "ready-for-review": 12,
  approved: 13,
  draft: 14,
  todo: 15,
  merged: 16,
  completed: 17,
  cancelled: 18,
}

export const statusOptions = issueStatusSchema.options.map((value) => ({
  value,
  label: statusLabels[value],
}))
