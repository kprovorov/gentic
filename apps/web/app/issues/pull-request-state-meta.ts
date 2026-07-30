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
  },
  open: {
    label: "open",
    icon: IconGitPullRequest,
    className: "bg-emerald-500/15 text-emerald-700 dark:text-emerald-300",
  },
  merged: {
    label: "merged",
    icon: IconGitMerge,
    className: "bg-indigo-500/15 text-indigo-700 dark:text-indigo-300",
  },
  closed: {
    label: "closed",
    icon: IconGitPullRequestClosed,
    className: "bg-rose-500/15 text-rose-700 dark:text-rose-300",
  },
  queued: {
    label: "queued",
    icon: IconClock,
    className: "bg-sky-500/15 text-sky-700 dark:text-sky-300",
  },
  unknown: {
    label: "status unavailable",
    icon: IconCircleDashed,
    className: "bg-muted text-muted-foreground",
  },
} satisfies Record<
  GithubPullRequestState,
  {
    label: string
    icon: typeof IconClock
    className: string
  }
>
