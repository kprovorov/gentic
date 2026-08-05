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
    automaticPrPublishingInProgress,
    relations,
    relationCandidates,
    events,
    labels,
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
    <div className="flex min-w-0 flex-col bg-background xl:h-[calc(100svh-3.5rem)] xl:overflow-hidden">
      <RealtimeRefresh
        channelName={`issue-${issue.id}-detail`}
        tables={[
          "issues",
          "issue_pull_requests",
          "issue_relations",
          "attachments",
          "issue_events",
          "issue_labels",
        ]}
      />
      <IssueSlugUrlSync issue={issue} />
      <IssueDetailHeader issue={issue} />

      <div className="flex min-w-0 flex-1 flex-col border-t xl:min-h-0 xl:flex-row">
        <IssueDetailTimelinePanel
          issueId={issue.id}
          issueCreatedAt={issue.created_at}
          issueBody={issue.body}
          agentProvider={issue.agent_provider}
          issueModel={issue.issue_model}
          initialMessages={messages}
          initialStatus={issue.status}
          initialUsageLimitResetAt={issue.usage_limit_reset_at}
          initialPrUrl={issue.pr_url}
          initialPullRequests={pullRequests}
          attachments={attachments}
          events={events}
        />

        <aside className="min-w-0 border-t bg-muted/25 xl:w-[19rem] xl:shrink-0 xl:overflow-y-auto xl:border-t-0 xl:border-l">
          <IssueDetailRail
            issueId={issue.id}
            issueCode={issue.code}
            status={issue.status}
            priority={issue.priority}
            hasUnpublishedAgentChanges={issue.has_unpublished_agent_changes}
            automaticPrPublishingInProgress={automaticPrPublishingInProgress}
            pullRequests={displayedPullRequests}
            relations={relations}
            relationCandidates={relationCandidates}
            labels={labels}
            attachments={attachments}
          />
        </aside>
      </div>
    </div>
  )
}
