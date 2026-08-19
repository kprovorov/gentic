import type { Database } from "./database.types"

export type { Database, Json } from "./database.types"

export type Tables<
  TableName extends keyof Database["public"]["Tables"],
> = Database["public"]["Tables"][TableName]["Row"]

export type Inserts<
  TableName extends keyof Database["public"]["Tables"],
> = Database["public"]["Tables"][TableName]["Insert"]

export type Updates<
  TableName extends keyof Database["public"]["Tables"],
> = Database["public"]["Tables"][TableName]["Update"]

export type IssuePriority = Database["public"]["Enums"]["issue_priority"]
export type Issue = Tables<"issues">
export type Label = Tables<"labels">
export type IssueLabel = Tables<"issue_labels">
export type Message = Tables<"messages">
export type IssueAutomaticPrRequest = Tables<"issue_automatic_pr_requests">
export type IssueReviewPolicy = Tables<"issue_review_policies">
export type Worker = Tables<"workers">
export type WorkerEnrollmentCode = Tables<"worker_enrollment_codes">
