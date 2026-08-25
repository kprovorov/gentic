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
  // Written directly by the `deliver_review_fix_request` RPC (GEN-417), not
  // through `logIssueEvent` — listed here so TypeScript readers of
  // `issue_events` have a complete, typed picture of what they may see.
  | "review_fix_delivered"

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
