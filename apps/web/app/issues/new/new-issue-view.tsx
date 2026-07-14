"use client"

import Link from "next/link"
import { useQuery } from "@tanstack/react-query"
import {
  IconArrowLeft,
  IconChevronDown,
  IconDeviceFloppy,
  IconPlayerPlay,
} from "@tabler/icons-react"

import { runIssue, saveIssueDraft } from "@/app/issues/actions"
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
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@gentic/ui/dropdown-menu"
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
              <form
                action={saveIssueDraft}
                className="grid gap-5"
                id="new-issue-form"
              >
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

                <div className="flex justify-end gap-2">
                  <Button asChild variant="outline">
                    <Link href="/issues">Cancel</Link>
                  </Button>
                  <Button type="submit" variant="secondary">
                    <IconDeviceFloppy />
                    Save draft
                  </Button>
                  <div className="flex items-center">
                    <Button
                      type="submit"
                      formAction={runIssue}
                      className="rounded-r-none border-r-primary-foreground/25"
                    >
                      <IconPlayerPlay />
                      Run
                    </Button>
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <Button
                          type="button"
                          aria-label="Choose agent"
                          className="rounded-l-none border-l-primary-foreground/25 px-2"
                        >
                          <IconChevronDown />
                        </Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end" className="min-w-48">
                        <DropdownMenuItem asChild>
                          <button
                            type="submit"
                            form="new-issue-form"
                            formAction={runIssue}
                            name="agent_provider"
                            value="codex"
                            className="w-full"
                          >
                            Run with Codex
                          </button>
                        </DropdownMenuItem>
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </div>
                </div>
              </form>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  )
}
