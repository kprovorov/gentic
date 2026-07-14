export type ChatMessage = {
  id: string
  // Stable React key that survives optimistic-id -> server-id replacement.
  clientKey?: string
  role: "user" | "assistant" | "system"
  kind: "text" | "tool" | "thinking"
  content: string | null
  status: "streaming" | "complete" | "error"
  created_at: string
}
