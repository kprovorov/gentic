"use client"

import Link from "next/link"
import { useQuery } from "@tanstack/react-query"
import { IconArrowLeft, IconPlus } from "@tabler/icons-react"

import { createIssue } from "@/app/issues/actions"
import { getNewIssueData, type ProjectOption } from "@/app/queries"
import { queryKeys } from "@/app/query-keys"
import { Button } from "@gentic/ui/button"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@gentic/ui/card"
import { Label } from "@gentic/ui/label"
import { NativeSelect, NativeSelectOption } from "@gentic/ui/native-select"

export function NewIssueView({
  initialData,
}: {
  initialData: { projects: ProjectOption[] }
}) {
  const { data } = useQuery({
    queryKey: queryKeys.newIssue,
    queryFn: getNewIssueData,
    initialData,
  })
  const { projects } = data

  return (
    <div className="bg-background px-4 py-8 md:px-8">
      <div className="mx-auto flex w-full max-w-3xl flex-col gap-8">
        <header className="flex flex-col gap-4 border-b pb-6">
          <Button asChild variant="ghost" className="w-fit">
            <Link href="/issues">
              <IconArrowLeft />
              Back
            </Link>
          </Button>
          <div className="grid gap-2">
            <p className="text-sm font-medium text-muted-foreground">Issues</p>
            <h1 className="text-3xl">New issue</h1>
          </div>
        </header>

        <Card>
          <CardHeader>
            <CardTitle>Create issue</CardTitle>
            <CardDescription>
              Add an issue to one of your tracked projects.
            </CardDescription>
          </CardHeader>
          <CardContent>
            {projects.length === 0 ? (
              <div className="grid gap-4 rounded-lg border border-dashed p-6 text-center">
                <p className="text-sm text-muted-foreground">
                  Create a project before adding issues.
                </p>
                <Button asChild variant="outline" className="mx-auto">
                  <Link href="/settings">Go to projects</Link>
                </Button>
              </div>
            ) : (
              <form action={createIssue} className="grid gap-5">
                <div className="grid gap-2">
                  <Label htmlFor="issue-project">Project</Label>
                  <NativeSelect
                    name="project_id"
                    required
                    defaultValue={projects[0]?.id}
                    id="issue-project"
                    className="w-full"
                  >
                    {projects.map((project) => (
                      <NativeSelectOption key={project.id} value={project.id}>
                        {project.name} ({project.repo})
                      </NativeSelectOption>
                    ))}
                  </NativeSelect>
                </div>

                <div className="grid gap-2">
                  <Label htmlFor="issue-type">Type</Label>
                  <NativeSelect
                    name="type"
                    required
                    defaultValue="feature"
                    id="issue-type"
                    className="w-full"
                  >
                    <NativeSelectOption value="feature">
                      Feature
                    </NativeSelectOption>
                    <NativeSelectOption value="bug">Bug</NativeSelectOption>
                    <NativeSelectOption value="feedback">
                      Feedback
                    </NativeSelectOption>
                    <NativeSelectOption value="idea">Idea</NativeSelectOption>
                  </NativeSelect>
                </div>

                <div className="grid gap-2">
                  <Label htmlFor="issue-agent-provider">Agent</Label>
                  <NativeSelect
                    name="agent_provider"
                    required
                    defaultValue="claude_code"
                    id="issue-agent-provider"
                    className="w-full"
                  >
                    <NativeSelectOption value="claude_code">
                      Claude Code
                    </NativeSelectOption>
                    <NativeSelectOption value="codex">Codex</NativeSelectOption>
                  </NativeSelect>
                </div>

                <div className="grid gap-2">
                  <Label htmlFor="issue-prompt">Prompt</Label>
                  <textarea
                    id="issue-prompt"
                    name="prompt"
                    rows={6}
                    placeholder="Describe the issue, acceptance notes, or links."
                    required
                    className="w-full resize-y rounded-3xl border border-transparent bg-input/50 px-3 py-2 text-base transition-[color,box-shadow,background-color] outline-none placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/30 md:text-sm"
                  />
                </div>

                <div className="grid gap-2">
                  <Label htmlFor="issue-status">Status</Label>
                  <NativeSelect
                    name="status"
                    required
                    defaultValue="draft"
                    id="issue-status"
                    className="w-full"
                  >
                    <NativeSelectOption value="draft">Draft</NativeSelectOption>
                    <NativeSelectOption value="todo">To do</NativeSelectOption>
                    <NativeSelectOption value="queued">
                      Queued
                    </NativeSelectOption>
                    <NativeSelectOption value="held">
                      On hold
                    </NativeSelectOption>
                    <NativeSelectOption value="in-progress">
                      In progress
                    </NativeSelectOption>
                    <NativeSelectOption value="waiting-for-input">
                      Waiting for input
                    </NativeSelectOption>
                    <NativeSelectOption value="testing">
                      Testing
                    </NativeSelectOption>
                    <NativeSelectOption value="tests-failed">
                      Tests failed
                    </NativeSelectOption>
                    <NativeSelectOption value="ready-for-review">
                      Ready for review
                    </NativeSelectOption>
                    <NativeSelectOption value="changes-requested">
                      Changes requested
                    </NativeSelectOption>
                    <NativeSelectOption value="approved">
                      Approved
                    </NativeSelectOption>
                    <NativeSelectOption value="merged">
                      Merged
                    </NativeSelectOption>
                    <NativeSelectOption value="deploying">
                      Deploying
                    </NativeSelectOption>
                    <NativeSelectOption value="deploy-failed">
                      Deploy failed
                    </NativeSelectOption>
                    <NativeSelectOption value="validating">
                      Validating
                    </NativeSelectOption>
                    <NativeSelectOption value="run-failed">
                      Run failed
                    </NativeSelectOption>
                    <NativeSelectOption value="completed">
                      Completed
                    </NativeSelectOption>
                    <NativeSelectOption value="cancelled">
                      Cancelled
                    </NativeSelectOption>
                  </NativeSelect>
                </div>

                <div className="flex justify-end gap-2">
                  <Button asChild variant="outline">
                    <Link href="/issues">Cancel</Link>
                  </Button>
                  <Button type="submit">
                    <IconPlus />
                    Create issue
                  </Button>
                </div>
              </form>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  )
}
