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
export type Worker = Tables<"workers">
export type WorkerEnrollmentCode = Tables<"worker_enrollment_codes">
