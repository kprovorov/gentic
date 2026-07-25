"use client"

import Link from "next/link"
import { useQuery } from "@tanstack/react-query"
import { IconListDetails } from "@tabler/icons-react"

import { fetchNewIssueData } from "@/app/client-queries"
import type { ProjectOption } from "@/app/queries"
import { queryKeys, queryStaleTimes } from "@/app/query-keys"
import { Button } from "@gentic/ui/button"

import { IssueCreateForm } from "../issues/issue-create-form"

export function HomeView({
  initialData,
}: {
  initialData: { projects: ProjectOption[] }
}) {
  const { data: newIssueData } = useQuery({
    queryKey: queryKeys.newIssue,
    queryFn: fetchNewIssueData,
    initialData,
    staleTime: queryStaleTimes.formOptions,
  })

  return (
    <div className="bg-background px-4 py-8 md:px-8">
      <div className="mx-auto flex w-full max-w-6xl flex-col gap-8">
        <header className="flex flex-col gap-4 border-b pb-6 md:flex-row md:items-end md:justify-between">
          <div className="grid gap-2">
            <p className="text-muted-foreground text-sm font-medium">Home</p>
            <h1 className="text-3xl">Create issue</h1>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button asChild variant="outline">
              <Link href="/issues">
                <IconListDetails />
                View issues
              </Link>
            </Button>
          </div>
        </header>

        <section className="mx-auto w-full max-w-3xl">
          <IssueCreateForm
            projects={newIssueData.projects}
            className="w-full"
          />
        </section>
      </div>
    </div>
  )
}
