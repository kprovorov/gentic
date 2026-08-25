import type { Json } from "@gentic/supabase/types"

import { unwrap } from "../errors"
import type { Supabase } from "../types"

export type IssueEventType =
  | "status_changed"
  | "priority_changed"
  | "labels_changed"
  | "pr_opened"
  | "pr_associated"
  | "pr_merged"
  // Written directly by SQL (RPCs below), not through `logIssueEvent` —
  // listed here so TypeScript readers of `issue_events` have a complete,
  // typed picture of what they may see.
  //
  // `deliver_review_fix_request` (GEN-417):
  | "review_fix_delivered"
  // `start_fresh_implementation` (GEN-403):
  | "implementation_ownership_reset"
  // `reconcile_offline_worker_runs`:
  | "run_failed"
  // The Automatic Review lifecycle engine (GEN-413/414/419, see ADR-0004):
  // `evaluate_review_eligibility` and `retry_review_run`:
  | "review_queued"
  // `claim_review_run`:
  | "review_started"
  // `complete_review_attempt` (verdict = approved) and
  // `continue_with_human_review`:
  | "review_approved"
  // `complete_review_attempt` (verdict = changes_requested | commented):
  | "review_changes_requested"
  // `fail_review_run`:
  | "review_failed"
  // `supersede_active_review_cycle`:
  | "review_superseded"

export async function logIssueEvent(
  supabase: Supabase,
  issueId: string,
  type: IssueEventType,
  payload: Json
) {
  unwrap(
    await supabase.from("issue_events").insert({
      issue_id: issueId,
      type,
      payload,
    })
  )
}
