import {
  IconCircleDashed,
  IconClock,
  IconGitMerge,
  IconGitPullRequest,
  IconGitPullRequestClosed,
  IconGitPullRequestDraft,
} from "@tabler/icons-react"

import type { GithubPullRequestState } from "@/lib/github-app"

export const pullRequestStateMeta = {
  draft: {
    label: "draft",
    icon: IconGitPullRequestDraft,
    className: "bg-muted text-muted-foreground",
    iconClassName: "text-muted-foreground",
  },
  open: {
    label: "open",
    icon: IconGitPullRequest,
    className: "bg-muted text-muted-foreground",
    iconClassName: "text-emerald-600 dark:text-emerald-300",
  },
  merged: {
    label: "merged",
    icon: IconGitMerge,
    className: "bg-muted text-muted-foreground",
    iconClassName: "text-indigo-600 dark:text-indigo-300",
  },
  closed: {
    label: "closed",
    icon: IconGitPullRequestClosed,
    className: "bg-muted text-muted-foreground",
    iconClassName: "text-rose-600 dark:text-rose-300",
  },
  queued: {
    label: "queued",
    icon: IconClock,
    className: "bg-muted text-muted-foreground",
    iconClassName: "text-sky-600 dark:text-sky-300",
  },
  unknown: {
    label: "status unavailable",
    icon: IconCircleDashed,
    className: "bg-muted text-muted-foreground",
    iconClassName: "text-muted-foreground",
  },
} satisfies Record<
  GithubPullRequestState,
  {
    label: string
    icon: typeof IconClock
    className: string
    iconClassName: string
  }
>
