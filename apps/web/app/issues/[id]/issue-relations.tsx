"use client"

import Link from "next/link"
import type React from "react"
import { useMutation, useQueryClient } from "@tanstack/react-query"
import { IconArrowRight, IconLink, IconTrash } from "@tabler/icons-react"

import { Button } from "@gentic/ui/button"
import { NativeSelect, NativeSelectOption } from "@gentic/ui/native-select"

import { addIssueRelation, deleteIssueRelation } from "@/app/issues/actions"
import { queryKeys } from "@/app/query-keys"
import type { IssueRelation, IssueRelationIssue } from "@gentic/services/issues"

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
  const queryClient = useQueryClient()
  const mutation = useMutation({
    mutationFn: deleteIssueRelation,
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: queryKeys.issue(issueId) }),
        queryClient.invalidateQueries({ queryKey: queryKeys.home }),
        queryClient.invalidateQueries({ queryKey: queryKeys.issues }),
      ])
    },
  })

  function handleDelete(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    mutation.mutate(new FormData(event.currentTarget))
  }

  return (
    <li className="flex items-center justify-between gap-3 rounded-2xl bg-muted/40 px-3 py-2">
      <Link
        href={`/issues/${relatedIssue.id}`}
        className="min-w-0 text-sm font-medium hover:text-primary"
      >
        <span className="line-clamp-1">
          {relatedIssue.title ?? "Generating title…"}
        </span>
      </Link>
      <form onSubmit={handleDelete}>
        <input type="hidden" name="id" value={relation.id} />
        <input type="hidden" name="issue_id" value={issueId} />
        <Button
          type="submit"
          variant="ghost"
          size="icon-xs"
          aria-label={`Remove relation to ${relatedIssue.title ?? "issue"}`}
          disabled={mutation.isPending}
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
  const queryClient = useQueryClient()
  const mutation = useMutation({
    mutationFn: addIssueRelation,
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: queryKeys.issue(issueId) }),
        queryClient.invalidateQueries({ queryKey: queryKeys.home }),
        queryClient.invalidateQueries({ queryKey: queryKeys.issues }),
      ])
    },
  })
  function handleAdd(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    mutation.mutate(new FormData(event.currentTarget))
    event.currentTarget.reset()
  }

  const blocking = relations.filter(
    (relation) => relation.source_issue_id === issueId
  )
  const blockedBy = relations.filter(
    (relation) => relation.target_issue_id === issueId
  )

  return (
    <div className="grid gap-5">
      <form onSubmit={handleAdd} className="grid gap-3">
        <input type="hidden" name="issue_id" value={issueId} />
        <div className="grid gap-3">
          <NativeSelect
            name="related_issue_id"
            disabled={candidates.length === 0}
            required
            aria-label="Related issue"
            className="w-full min-w-0"
          >
            <NativeSelectOption value="" disabled>
              Select issue
            </NativeSelectOption>
            {candidates.map((candidate) => (
              <NativeSelectOption key={candidate.id} value={candidate.id}>
                {candidate.title ?? "Generating title…"}
              </NativeSelectOption>
            ))}
          </NativeSelect>
          <NativeSelect
            name="direction"
            disabled={candidates.length === 0}
            defaultValue="blocking"
            aria-label="Relation direction"
            className="w-full"
          >
            <NativeSelectOption value="blocking">
              is blocking
            </NativeSelectOption>
            <NativeSelectOption value="blocked_by">
              is blocked by
            </NativeSelectOption>
          </NativeSelect>
          <Button
            type="submit"
            disabled={candidates.length === 0 || mutation.isPending}
          >
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

      <div className="grid gap-4">
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
          <span>
            A relation points from the blocking issue to the blocked issue.
          </span>
        </div>
      ) : null}
    </div>
  )
}
