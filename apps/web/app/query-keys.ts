export const queryKeys = {
  home: ["home"] as const,
  settings: ["settings"] as const,
  newIssue: ["issues", "new"] as const,
  issue: (id: string) => ["issues", id] as const,
  issueEdit: (id: string) => ["issues", id, "edit"] as const,
}
