export const queryKeys = {
  home: ["home"] as const,
  issues: ["issues"] as const,
  settings: ["settings"] as const,
  // Prefix shared by every `settingsLabels(search)` variant. Invalidating this
  // root refreshes the whole label catalog (all searches, every picker) at once.
  settingsLabelsRoot: ["settings", "labels"] as const,
  settingsLabels: (search = "") => ["settings", "labels", search] as const,
  settingsHosts: ["settings", "hosts"] as const,
  newIssue: ["issues", "new"] as const,
  issue: (id: string) => ["issues", id] as const,
  issueEdit: (id: string) => ["issues", id, "edit"] as const,
}

export const queryStaleTimes = {
  realtime: 30_000,
  settings: 60_000,
  settingsHostsPoll: 15_000,
  formOptions: 60_000,
} as const
