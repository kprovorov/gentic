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
    archivedLabelIds,
  } = data
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
          // Definition edits (rename/recolor/archive/restore) touch `labels`
          // only; refresh so assigned chips, counts, and the timeline's
          // archived styling stay current without a reload.
          "labels",
        ]}
      />
      <IssueSlugUrlSync issue={issue} />
      <IssueDetailHeader
        issue={issue}
        pullRequests={pullRequests}
        automaticPrPublishingInProgress={automaticPrPublishingInProgress}
        relations={relations}
        relationCandidates={relationCandidates}
        labels={labels}
        attachments={attachments}
      />

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
          initialPullRequests={pullRequests}
          attachments={attachments}
          events={events}
          archivedLabelIds={archivedLabelIds}
        />

        {/* Below xl the rail's contents move into the header's properties
            dialog rather than stacking underneath the chat. */}
        <aside className="hidden min-w-0 bg-muted/25 xl:block xl:w-[19rem] xl:shrink-0 xl:overflow-y-auto xl:border-l">
          <IssueDetailRail
            issueId={issue.id}
            issueCode={issue.code}
            status={issue.status}
            priority={issue.priority}
            hasUnpublishedAgentChanges={issue.has_unpublished_agent_changes}
            automaticPrPublishingInProgress={automaticPrPublishingInProgress}
            pullRequests={pullRequests}
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
