import type { IssueDetailData } from "@/app/queries"
import { RealtimeRefresh } from "@/components/realtime-refresh"

import { IssueDetailHeader } from "./issue-detail-header"
import { IssueDetailRail } from "./issue-detail-rail"
import { IssueDetailTimelinePanel } from "./issue-detail-timeline-panel"
import { IssueSlugUrlSync } from "./issue-slug-url-sync"

export function IssueDetailView({ data }: { data: IssueDetailData }) {
  const {
    issue,
    messages,
    attachments,
    pullRequests,
    relations,
    relationCandidates,
    events,
  } = data
  const displayedPullRequests =
    pullRequests.length > 0
      ? pullRequests
      : issue.pr_url
        ? [
            {
              id: "legacy-pr-url",
              issue_id: issue.id,
              url: issue.pr_url,
              created_at: issue.updated_at,
            },
          ]
        : []

  return (
    <div className="bg-background px-4 py-8 md:px-8">
      <RealtimeRefresh
        channelName={`issue-${issue.id}-detail`}
        tables={[
          "issues",
          "issue_pull_requests",
          "issue_relations",
          "attachments",
          "issue_events",
        ]}
      />
      <IssueSlugUrlSync key={issue.title ?? ""} issue={issue} />
      <div className="mx-auto flex w-full max-w-7xl flex-col gap-6">
        <IssueDetailHeader issue={issue} />

        <section className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_19rem] lg:items-start">
          <IssueDetailTimelinePanel
            issueId={issue.id}
            issueCreatedAt={issue.created_at}
            issuePrompt={issue.prompt}
            agentProvider={issue.agent_provider}
            initialMessages={messages}
            initialStatus={issue.status}
            initialUsageLimitResetAt={issue.usage_limit_reset_at}
            initialPrUrl={issue.pr_url}
            initialPullRequests={pullRequests}
            attachments={attachments}
            events={events}
          />

          <div className="lg:sticky lg:top-6">
            <IssueDetailRail
              issueId={issue.id}
              status={issue.status}
              pullRequests={displayedPullRequests}
              relations={relations}
              relationCandidates={relationCandidates}
              attachments={attachments}
            />
          </div>
        </section>
      </div>
    </div>
  )
}
