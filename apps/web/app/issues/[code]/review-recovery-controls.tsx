"use client"

import { useMutation, useQueryClient } from "@tanstack/react-query"
import { toast } from "sonner"

import { Button } from "@gentic/ui/button"
import type {
  ImplementationOwner,
  ImplementationOwnerUnavailableReason,
  ReviewCycle,
} from "@gentic/services/issues"

import { findReviewRetryTarget } from "@/app/issues/review-state-meta"
import { queryKeys } from "@/app/query-keys"

import {
  continueWithHumanReviewAction,
  retryReviewRunAction,
  startFreshImplementationAction,
} from "../actions"

const UNAVAILABLE_REASON_LABEL: Record<
  ImplementationOwnerUnavailableReason,
  string
> = {
  provider_changed: "the agent or model changed since the original run",
  session_missing: "no resumable session was ever recorded",
  host_deleted: "the original host was deleted",
  host_banned: "the original host is banned",
}

/**
 * Recovery controls for a stuck or blocked Automatic Review (GEN-419):
 * re-trigger the reviewer, accept a human review as sufficient, or abandon
 * an unresumable implementation session. Visibility is derived from
 * `reviewCycles`/`implementationOwner` — a superseded/exhausted/approved
 * cycle fails every check below by construction, so stale controls never
 * render (no separate guard needed).
 */
export function ReviewRecoveryControls({
  issueId,
  reviewCycles,
  implementationOwner,
}: {
  issueId: string
  reviewCycles: ReviewCycle[]
  implementationOwner: ImplementationOwner | null
}) {
  const queryClient = useQueryClient()

  async function invalidate() {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: queryKeys.issue(issueId) }),
      queryClient.invalidateQueries({ queryKey: queryKeys.home }),
      queryClient.invalidateQueries({ queryKey: queryKeys.issues }),
    ])
  }

  const retryMutation = useMutation({
    mutationFn: retryReviewRunAction,
    onSuccess: invalidate,
    onError: () => toast.error("Couldn't re-trigger the review"),
  })
  const continueMutation = useMutation({
    mutationFn: continueWithHumanReviewAction,
    onSuccess: invalidate,
    onError: () => toast.error("Couldn't continue with human review"),
  })
  const freshMutation = useMutation({
    mutationFn: startFreshImplementationAction,
    onSuccess: invalidate,
    onError: () => toast.error("Couldn't start a fresh implementation session"),
  })

  const retryTarget = findReviewRetryTarget(reviewCycles)
  const activeCycle =
    reviewCycles.find((cycle) => cycle.state === "active") ?? null
  const showOwnerControl =
    implementationOwner !== null && !implementationOwner.resumable

  if (!retryTarget && !activeCycle && !showOwnerControl) {
    return null
  }

  function handleRetry() {
    if (!retryTarget || retryMutation.isPending) {
      return
    }
    if (
      !window.confirm(
        retryTarget.force
          ? "Restart the automatic review now? The review already in flight will be cancelled — this doesn't use up a review attempt."
          : "Retry the automatic review now?"
      )
    ) {
      return
    }
    const formData = new FormData()
    formData.set("issue_id", issueId)
    formData.set("review_cycle_id", retryTarget.cycle.id)
    formData.set("force", String(retryTarget.force))
    retryMutation.mutate(formData)
  }

  function handleContinue() {
    if (continueMutation.isPending) {
      return
    }
    if (
      !window.confirm(
        "Accept the human review as sufficient and stop further automatic review attempts?"
      )
    ) {
      return
    }
    const formData = new FormData()
    formData.set("issue_id", issueId)
    continueMutation.mutate(formData)
  }

  function handleFresh() {
    if (freshMutation.isPending) {
      return
    }
    if (
      !window.confirm(
        "Start a fresh implementation session? This abandons the current session — a new one will pick up the next fix."
      )
    ) {
      return
    }
    const formData = new FormData()
    formData.set("issue_id", issueId)
    freshMutation.mutate(formData)
  }

  return (
    <div className="grid gap-1.5">
      {retryTarget ? (
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="justify-start"
          disabled={retryMutation.isPending}
          onClick={handleRetry}
        >
          {retryTarget.force ? "Restart review" : "Retry review"}
        </Button>
      ) : null}
      {activeCycle ? (
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="justify-start"
          disabled={continueMutation.isPending}
          onClick={handleContinue}
        >
          Continue with human review
        </Button>
      ) : null}
      {showOwnerControl ? (
        <>
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="justify-start"
            disabled={freshMutation.isPending}
            onClick={handleFresh}
          >
            Start fresh implementation session
          </Button>
          {implementationOwner?.unavailableReason ? (
            <p className="text-[11px] text-muted-foreground">
              The original session can&apos;t resume:{" "}
              {UNAVAILABLE_REASON_LABEL[implementationOwner.unavailableReason]}.
            </p>
          ) : null}
        </>
      ) : null}
    </div>
  )
}
