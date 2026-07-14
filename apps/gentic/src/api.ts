export interface ClaimedIssue {
  id: string
  runId: string
  agentProvider: "claude_code" | "codex"
  repo: string
  setupScript: string | null
  sessionId: string | null
  runFinishedAt: string | null
  prUrl: string | null
}

export interface RunStateFields {
  status?:
    | "in-progress"
    | "held"
    | "run-failed"
    | "ready-for-review"
    | "waiting-for-input"
  session_id?: string | null
  run_error?: string | null
  run_started_at?: string | null
  run_finished_at?: string | null
  usage_limit_reset_at?: string | null
  pr_url?: string | null
}

export interface UserMessage {
  id: string
  content: string | null
  created_at: string
}

export interface RealtimeTokenResponse {
  url: string
  apiKey: string
  token: string
  expiresAt: string
}

export interface InsertMessageInput {
  id: string
  role: "assistant" | "system"
  kind?: "text" | "tool" | "thinking"
  content: string
  status?: "complete" | "error"
}

export interface Attachment {
  id: string
  fileName: string
  contentType: string | null
  sizeBytes: number | null
  /** Short-lived signed URL the file can be downloaded from. */
  url: string
}

export interface AgentApi {
  claimNextQueuedIssue(): Promise<ClaimedIssue | null>
  heartbeatRun(issueId: string, runId: string): Promise<void>
  setRunState(
    issueId: string,
    runId: string,
    fields: RunStateFields
  ): Promise<void>
  insertMessage(
    issueId: string,
    runId: string,
    message: InsertMessageInput
  ): Promise<string>
  fetchUserMessagesAfter(issueId: string, cursor: string): Promise<UserMessage[]>
  fetchAttachments(issueId: string): Promise<Attachment[]>
  fetchRealtimeToken(): Promise<RealtimeTokenResponse>
}

export function createAgentApi(input: {
  apiUrl: string
  apiKey: string
}): AgentApi {
  const apiUrl = input.apiUrl.replace(/\/+$/, "")

  async function request<T>(
    path: string,
    options: { method?: string; body?: unknown } = {}
  ): Promise<T> {
    const headers: Record<string, string> = {
      authorization: `Bearer ${input.apiKey}`,
    }
    let body: string | undefined
    if (options.body !== undefined) {
      headers["content-type"] = "application/json"
      body = JSON.stringify(options.body)
    }

    const response = await fetch(`${apiUrl}${path}`, {
      method: options.method ?? "GET",
      headers: {
        ...headers,
      },
      body,
    })
    const payload = (await response.json().catch(() => null)) as unknown

    if (!response.ok) {
      const message =
        payload &&
        typeof payload === "object" &&
        "error" in payload &&
        typeof payload.error === "string"
          ? payload.error
          : `Gentic API request failed with ${response.status}`
      throw new Error(message)
    }

    return payload as T
  }

  return {
    async claimNextQueuedIssue() {
      const data = await request<{ issue: ClaimedIssue | null }>(
        "/agent/issues/claim",
        { method: "POST" }
      )
      return data.issue
    },
    async heartbeatRun(issueId, runId) {
      await request(`/agent/issues/${encodeURIComponent(issueId)}/run-state`, {
        method: "PATCH",
        body: { run_id: runId },
      })
    },
    async setRunState(issueId, runId, fields) {
      await request(`/agent/issues/${encodeURIComponent(issueId)}/run-state`, {
        method: "PATCH",
        body: { ...fields, run_id: runId },
      })
    },
    async insertMessage(issueId, runId, message) {
      const data = await request<{ id: string }>(
        `/agent/issues/${encodeURIComponent(issueId)}/messages`,
        {
          method: "POST",
          body: { ...message, run_id: runId },
        }
      )
      return data.id
    },
    async fetchUserMessagesAfter(issueId, cursor) {
      const params = new URLSearchParams({ after: cursor })
      const data = await request<{ messages: UserMessage[] }>(
        `/agent/issues/${encodeURIComponent(issueId)}/messages?${params}`
      )
      return data.messages
    },
    async fetchAttachments(issueId) {
      const data = await request<{ attachments: Attachment[] }>(
        `/agent/issues/${encodeURIComponent(issueId)}/attachments`
      )
      return data.attachments
    },
    async fetchRealtimeToken() {
      return request<RealtimeTokenResponse>("/agent/realtime/token", {
        method: "POST",
      })
    },
  }
}
