import type { IssueEventContract } from "@gentic/validators/realtime"

import { buildIssueTimeline } from "./issue-timeline/build-timeline"
import { IssueTimeline } from "./issue-timeline/issue-timeline"

/**
 * The timeline column for a Spec, which stands in for
 * `IssueDetailTimelinePanel`. A Spec is documentation rather than agent work,
 * so there is no conversation to stream and no composer to send into: the
 * column shows only the issue's own history — created, status, priority, and
 * label changes — and says plainly why the composer is missing.
 */
export function IssueSpecPanel({
  issueCreatedAt,
  events,
  archivedLabelIds,
}: {
  issueCreatedAt: string
  events: IssueEventContract[]
  archivedLabelIds: string[]
}) {
  const timelineItems = buildIssueTimeline({
    issue: { created_at: issueCreatedAt },
    messages: [],
    events,
  })

  return (
    <div className="flex min-h-0 min-w-0 flex-1 flex-col">
      <div className="min-w-0 flex-1 overflow-y-auto px-6 pt-5 pb-2">
        <div className="mx-auto w-full max-w-[840px]">
          <IssueTimeline
            items={timelineItems}
            archivedLabelIds={archivedLabelIds}
          />
        </div>
      </div>

      <div className="flex-none border-t px-6 py-4">
        <p className="mx-auto w-full max-w-[840px] text-sm text-muted-foreground">
          Specs are not handed to a coding agent, so this issue has no
          conversation. Edit the body to keep the spec current.
        </p>
      </div>
    </div>
  )
}
