export const queryKeys = {
  home: ["home"] as const,
  issues: ["issues"] as const,
  settings: ["settings"] as const,
  newIssue: ["issues", "new"] as const,
  issue: (id: string) => ["issues", id] as const,
  issueEdit: (id: string) => ["issues", id, "edit"] as const,
}

export const queryStaleTimes = {
  realtime: 30_000,
  settings: 60_000,
  formOptions: 60_000,
} as const
