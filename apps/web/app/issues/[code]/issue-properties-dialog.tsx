"use client"

import { IconPlus } from "@tabler/icons-react"

import {
  AgentProviderBadge,
  IssueTypeMenu,
  RepoBadge,
} from "@/app/issues/issues-columns"
import {
  interactiveIssueBadgeClassName,
  issueBadgeClassName,
} from "@/app/issues/issue-badge-styles"
import type { IssueDetailData, IssuePullRequest } from "@/app/queries"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@gentic/ui/dialog"
import { cn } from "@gentic/ui/utils"
import type { IssueRelation, IssueRelationIssue } from "@gentic/services/issues"
import type { LabelSnapshot } from "@gentic/validators/realtime"

import type { Attachment } from "./attachments"
import { IssueDetailRail, RailSection } from "./issue-detail-rail"

/**
 * Below xl the rail has no column to live in, so everything it holds — plus the
 * type/agent/repo pills the header only has room to summarise — is reachable
 * from this dialog, opened by the "+" that trails the header's pill row.
 */
export function IssuePropertiesDialog({
  issue,
  pullRequests,
  automaticPrPublishingInProgress,
  relations,
  relationCandidates,
  labels,
  attachments,
}: {
  issue: IssueDetailData["issue"]
  pullRequests: IssuePullRequest[]
  automaticPrPublishingInProgress: boolean
  relations: IssueRelation[]
  relationCandidates: IssueRelationIssue[]
  labels: LabelSnapshot[]
  attachments: Attachment[]
}) {
  return (
    <Dialog>
      <DialogTrigger asChild>
        <button
          type="button"
          aria-label="Open issue properties"
          className={cn(
            issueBadgeClassName,
            interactiveIssueBadgeClassName,
            "w-6 justify-center px-0"
          )}
        >
          <IconPlus className="size-3.5 shrink-0" />
        </button>
      </DialogTrigger>
      <DialogContent className="gap-0 overflow-hidden p-0 sm:p-0">
        <DialogHeader className="mb-0 border-b px-[18px] py-4">
          <DialogTitle>Properties</DialogTitle>
          <DialogDescription className="sr-only">
            Review and edit this issue&apos;s properties, labels, files, and
            relations.
          </DialogDescription>
        </DialogHeader>

        <div className="min-h-0 flex-1 divide-y divide-border/70 overflow-y-auto">
          <RailSection title="Details">
            <div className="flex flex-wrap items-center gap-1.5">
              <IssueTypeMenu issue={issue} />
              <AgentProviderBadge provider={issue.agent_provider} />
              {issue.projects ? <RepoBadge repo={issue.projects.repo} /> : null}
            </div>
          </RailSection>

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
        </div>
      </DialogContent>
    </Dialog>
  )
}
