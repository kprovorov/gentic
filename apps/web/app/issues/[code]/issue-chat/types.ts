import type { ChatMessage } from "../issue-chat-state"

export type { ChatMessage }

export type RealtimeConnectionStatus =
  | "connecting"
  | "connected"
  | "reconnecting"
  | "offline"
