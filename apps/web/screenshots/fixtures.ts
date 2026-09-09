import type { HomeIssue, IssueDetail } from "@/app/query-contracts"
import type { IssuePullRequest, IssuesData } from "@/app/queries"
import type { TimelineItem } from "@/app/issues/[code]/issue-timeline/build-timeline"
import type { ReviewCycle } from "@gentic/services/issues"

export const project = {
  id: "project-demo",
  name: "Orbit",
  repo: "orbit/web",
  key: "ORB",
}
export const labels = [
  { id: "frontend", name: "Frontend", color: "#8b5cf6" },
  { id: "api", name: "API", color: "#0ea5e9" },
  { id: "design", name: "Design", color: "#ec4899" },
  { id: "performance", name: "Performance", color: "#f59e0b" },
]
const time = (minute: number) =>
  `2026-09-08T10:${String(minute).padStart(2, "0")}:00.000Z`
function issue(
  number: number,
  title: string,
  status: HomeIssue["status"],
  options: Partial<HomeIssue> = {}
): HomeIssue {
  return {
    id: `demo-${number}`,
    code: `ORB-${number}`,
    number,
    title,
    status,
    type: "feature",
    priority: "medium",
    agent_provider: "claude_code",
    created_at: time(0),
    projects: project,
    labels: [labels[0]!],
    pullRequests: [],
    ...options,
  }
}
function pr(number: number, state: "open" | "draft" | "merged" = "open") {
  return {
    id: `pr-${number}`,
    url: `https://github.com/orbit/web/pull/${number}`,
    state,
  }
}
export const issuesData: IssuesData = {
  issues: [
    issue(128, "Add dark mode to the dashboard", "in-progress", {
      priority: "high",
      labels: [labels[0]!, labels[2]!],
      pullRequests: [pr(86, "draft")],
    }),
    issue(127, "Speed up project search", "in-progress", {
      type: "bug",
      agent_provider: "codex",
      labels: [labels[3]!],
      pullRequests: [pr(85, "draft")],
    }),
    issue(126, "Add keyboard shortcuts", "testing", {
      agent_provider: "codex",
      labels: [labels[0]!],
      pullRequests: [pr(84)],
    }),
    issue(125, "Remember notification preferences", "reviewing", {
      type: "bug",
      priority: "high",
      labels: [labels[1]!],
      pullRequests: [pr(83)],
    }),
    issue(124, "Build the activity feed", "approved", {
      labels: [labels[0]!, labels[1]!],
      pullRequests: [pr(82)],
    }),
    issue(123, "Polish the workspace switcher", "merged", {
      priority: "low",
      agent_provider: "codex",
      labels: [labels[2]!],
      pullRequests: [pr(81, "merged")],
    }),
  ],
  labels,
  blockedIssueIds: [],
  blockingIssueIds: ["demo-128"],
}
export const planningData: IssuesData = {
  issues: [
    issue(132, "Confirm the new onboarding flow", "waiting-for-input", {
      type: "spec",
      priority: "high",
      labels: [labels[2]!],
    }),
    issue(131, "Connect the billing settings", "queued", {
      agent_provider: "codex",
      labels: [labels[1]!],
    }),
    issue(130, "Add weekly activity summaries", "queued", {
      labels: [labels[0]!, labels[1]!],
    }),
    issue(129, "Explore command palette navigation", "draft", {
      type: "idea",
      priority: "low",
      labels: [labels[2]!],
    }),
  ],
  labels,
  blockedIssueIds: ["demo-131"],
  blockingIssueIds: ["demo-132"],
}
export const reviewIssue: IssueDetail = {
  ...issuesData.issues[4]!,
  body: "Show recent project activity in one feed. Group updates by day and keep unread items easy to spot.",
  issue_model: "claude-sonnet-5",
  active_run_id: null,
  usage_limit_reset_at: null,
  run_started_at: null,
  has_unpublished_agent_changes: false,
  create_pr_automatically: true,
  updated_at: time(24),
}
export const pullRequests: IssuePullRequest[] = [
  {
    ...pr(82),
    issue_id: reviewIssue.id,
    created_at: time(6),
    head_sha: "demo-head",
    ci_state: "success",
    review_decision: "APPROVED",
  },
]
export const reviewCycles: ReviewCycle[] = [
  {
    id: "review-demo",
    pullRequestId: "pr-82",
    state: "approved",
    headSha: "demo-head",
    supersededReason: null,
    createdAt: time(7),
    updatedAt: time(24),
    runs: [],
    attempts: [
      {
        id: "attempt-1",
        attemptNumber: 1,
        verdict: "changes_requested",
        summary: "Unread count needs to reset when switching projects.",
        githubReviewId: 81,
        publishedAt: time(12),
        createdAt: time(12),
        findings: [],
      },
      {
        id: "attempt-2",
        attemptNumber: 2,
        verdict: "approved",
        summary: "All findings resolved. Tests pass.",
        githubReviewId: 82,
        publishedAt: time(24),
        createdAt: time(24),
        findings: [],
      },
    ],
  },
]
export const timeline: TimelineItem[] = [
  { kind: "pr-opened", key: "pr", timestamp: time(6), prUrl: pr(82).url },
  {
    kind: "status-milestone",
    key: "testing",
    timestamp: time(7),
    from: "testing",
    to: "reviewing",
  },
  {
    kind: "review-started",
    key: "review",
    timestamp: time(8),
    reviewRunId: null,
  },
  {
    kind: "review-changes-requested",
    key: "findings",
    timestamp: time(12),
    verdict: "changes_requested",
    findingsCount: 1,
    attemptNumber: 1,
  },
  { kind: "review-fix-delivered", key: "delivered", timestamp: time(13) },
  {
    kind: "message",
    key: "fix",
    timestamp: time(18),
    message: {
      id: "fix-message",
      role: "assistant",
      kind: "text",
      status: "complete",
      created_at: time(18),
      content:
        "Fixed the unread count when switching projects. Added a regression test and pushed the update to the same pull request.",
    },
  },
  {
    kind: "review-approved",
    key: "approved",
    timestamp: time(24),
    source: "agent",
    attemptNumber: 2,
  },
  {
    kind: "status-milestone",
    key: "done",
    timestamp: time(24),
    from: "reviewing",
    to: "approved",
  },
]
