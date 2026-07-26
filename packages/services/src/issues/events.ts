import type { Json } from "@gentic/supabase/types"

import { unwrap } from "../errors"
import type { Supabase } from "../types"

export type IssueEventType = "status_changed" | "pr_opened" | "pr_merged"

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
