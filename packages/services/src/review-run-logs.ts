import { unwrap } from "./errors"
import type { Supabase } from "./types"

// The durable side of the Review Run log sink (GEN-415) — deliberately
// separate from Issue chat's `chat_messages`. Append-only; `seq` is assigned
// by the worker (a single incrementing counter per run), not computed here.
export async function appendReviewRunLog(
  supabase: Supabase,
  reviewRunId: string,
  input: {
    seq: number
    role: "assistant" | "system"
    content: string
  }
): Promise<void> {
  unwrap(
    await supabase.from("review_run_logs").insert({
      review_run_id: reviewRunId,
      seq: input.seq,
      role: input.role,
      content: input.content,
    })
  )
}
