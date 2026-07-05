import Link from "next/link"
import type React from "react"
import { IconArrowRight, IconLink, IconTrash } from "@tabler/icons-react"

import { Button } from "@gentic/ui/button"

import {
  addIssueRelation,
  deleteIssueRelation,
} from "@/app/issues/actions"
import type {
  IssueRelation,
  IssueRelationIssue,
} from "@gentic/services/issues"

type IssueRelationsProps = {
  issueId: string
  relations: IssueRelation[]
  candidates: IssueRelationIssue[]
}

function RelationRow({
  issueId,
  relation,
  relatedIssue,
}: {
  issueId: string
  relation: IssueRelation
  relatedIssue: IssueRelationIssue
}) {
  return (
    <li className="flex items-center justify-between gap-3 rounded-2xl bg-muted/40 px-3 py-2">
      <Link
        href={`/issues/${relatedIssue.id}`}
        className="min-w-0 text-sm font-medium hover:text-primary"
      >
        <span className="line-clamp-1">{relatedIssue.title}</span>
      </Link>
      <form action={deleteIssueRelation}>
        <input type="hidden" name="id" value={relation.id} />
        <input type="hidden" name="issue_id" value={issueId} />
        <Button
          type="submit"
          variant="ghost"
          size="icon-xs"
          aria-label={`Remove relation to ${relatedIssue.title}`}
        >
          <IconTrash />
        </Button>
      </form>
    </li>
  )
}

function RelationList({
  title,
  empty,
  children,
}: {
  title: string
  empty: string
  children: React.ReactNode
}) {
  const hasChildren = Array.isArray(children)
    ? children.length > 0
    : Boolean(children)

  return (
    <div className="grid gap-2">
      <h3 className="text-sm font-medium">{title}</h3>
      {hasChildren ? (
        <ul className="grid gap-2">{children}</ul>
      ) : (
        <p className="text-sm text-muted-foreground">{empty}</p>
      )}
    </div>
  )
}

export function IssueRelations({
  issueId,
  relations,
  candidates,
}: IssueRelationsProps) {
  const blocking = relations.filter(
    (relation) => relation.source_issue_id === issueId
  )
  const blockedBy = relations.filter(
    (relation) => relation.target_issue_id === issueId
  )

  return (
    <div className="grid gap-5">
      <form action={addIssueRelation} className="grid gap-3">
        <input type="hidden" name="issue_id" value={issueId} />
        <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_minmax(10rem,auto)_auto]">
          <select
            name="related_issue_id"
            disabled={candidates.length === 0}
            className="h-9 min-w-0 rounded-3xl border border-transparent bg-input/50 px-3 text-sm transition-[color,box-shadow,background-color] outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/30 disabled:opacity-70"
            aria-label="Related issue"
            required
          >
            <option value="">Select issue</option>
            {candidates.map((candidate) => (
              <option key={candidate.id} value={candidate.id}>
                {candidate.title}
              </option>
            ))}
          </select>
          <select
            name="direction"
            disabled={candidates.length === 0}
            className="h-9 rounded-3xl border border-transparent bg-input/50 px-3 text-sm transition-[color,box-shadow,background-color] outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/30 disabled:opacity-70"
            aria-label="Relation direction"
            defaultValue="blocking"
          >
            <option value="blocking">is blocking</option>
            <option value="blocked_by">is blocked by</option>
          </select>
          <Button type="submit" disabled={candidates.length === 0}>
            <IconLink />
            Add
          </Button>
        </div>
        {candidates.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            Create another issue before adding relations.
          </p>
        ) : null}
      </form>

      <div className="grid gap-4 sm:grid-cols-2">
        <RelationList
          title="Blocking"
          empty="This issue is not blocking anything."
        >
          {blocking.map((relation) => (
            <RelationRow
              key={relation.id}
              issueId={issueId}
              relation={relation}
              relatedIssue={relation.target_issue}
            />
          ))}
        </RelationList>

        <RelationList
          title="Blocked by"
          empty="This issue is not blocked by another issue."
        >
          {blockedBy.map((relation) => (
            <RelationRow
              key={relation.id}
              issueId={issueId}
              relation={relation}
              relatedIssue={relation.source_issue}
            />
          ))}
        </RelationList>
      </div>

      {relations.length > 0 ? (
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          <IconArrowRight className="size-3.5" />
          A relation points from the blocking issue to the blocked issue.
        </div>
      ) : null}
    </div>
  )
}
