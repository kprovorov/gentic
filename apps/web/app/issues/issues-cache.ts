import type { QueryClient } from "@tanstack/react-query"

import type { HomeIssue, IssuesData } from "@/app/queries"
import { queryKeys } from "@/app/query-keys"

export function updateIssuesInCaches(
  queryClient: QueryClient,
  predicate: (issue: HomeIssue) => boolean,
  updater: (issue: HomeIssue) => HomeIssue
) {
  const updateData = (current: IssuesData | undefined) =>
    current
      ? {
          ...current,
          issues: current.issues.map((issue) =>
            predicate(issue) ? updater(issue) : issue
          ),
        }
      : current

  queryClient.setQueryData(queryKeys.issues, updateData)
  queryClient.setQueryData(queryKeys.home, updateData)
}
