"use client"

import { useQuery } from "@tanstack/react-query"

import { fetchNewIssueData } from "@/app/client-queries"
import type { ProjectOption } from "@/app/queries"
import { queryKeys, queryStaleTimes } from "@/app/query-keys"

import { IssueCreateForm } from "../issue-create-form"

export function NewIssueView({
  initialData,
}: {
  initialData: { projects: ProjectOption[] }
}) {
  const { data } = useQuery({
    queryKey: queryKeys.newIssue,
    queryFn: fetchNewIssueData,
    initialData,
    staleTime: queryStaleTimes.formOptions,
  })
  const { projects } = data

  return (
    <div className="bg-background px-4 py-8 md:px-8">
      <div className="mx-auto flex min-h-[calc(100svh-10rem)] w-full max-w-3xl flex-col justify-center">
        <IssueCreateForm projects={projects} className="w-full" />
      </div>
    </div>
  )
}
