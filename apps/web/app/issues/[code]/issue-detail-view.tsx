import type { IssueDetailData } from "@/app/queries"
import { RealtimeRefresh } from "@/components/realtime-refresh"
import { isSpecIssueType } from "@gentic/validators/issues"

import { IssueDetailHeader } from "./issue-detail-header"
import { IssueDetailRail } from "./issue-detail-rail"
import { IssueDetailTimelinePanel } from "./issue-detail-timeline-panel"
import { IssueSlugUrlSync } from "./issue-slug-url-sync"
import { IssueSpecPanel } from "./issue-spec-panel"

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
  const isSpec = isSpecIssueType(issue.type)
  // Full viewport height at every breakpoint so the composer pins to the
  // bottom of the screen instead of the page scrolling past it on mobile.
  // `dvh` (not `svh`) keeps that flush as mobile browser chrome resizes the
  // viewport; `--keyboard-inset` (see `KeyboardInsetSync`) covers the browsers
  // where `dvh` ignores the on-screen keyboard, so the timeline is the only
  // thing that scrolls and the composer stays pinned above the keyboard.
  return (
    <div className="flex h-[calc(100dvh-3.5rem-var(--keyboard-inset,0px))] min-w-0 flex-col overflow-hidden bg-background">
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

      <div className="flex min-h-0 min-w-0 flex-1 flex-col border-t xl:flex-row">
        {isSpec ? (
          <IssueSpecPanel
            issueCreatedAt={issue.created_at}
            events={events}
            archivedLabelIds={archivedLabelIds}
          />
        ) : (
          <IssueDetailTimelinePanel
            issueId={issue.id}
            issueCreatedAt={issue.created_at}
            agentProvider={issue.agent_provider}
            issueModel={issue.issue_model}
            initialMessages={messages}
            initialStatus={issue.status}
            initialUsageLimitResetAt={issue.usage_limit_reset_at}
            initialPullRequests={pullRequests}
            events={events}
            archivedLabelIds={archivedLabelIds}
          />
        )}

        {/* Below xl the rail's contents move into the header's properties
            dialog rather than stacking underneath the chat. */}
        <aside className="hidden min-w-0 bg-muted/25 xl:block xl:w-[19rem] xl:shrink-0 xl:overflow-y-auto xl:border-l">
          <IssueDetailRail
            issueId={issue.id}
            issueCode={issue.code}
            status={issue.status}
            priority={issue.priority}
            isSpec={isSpec}
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
