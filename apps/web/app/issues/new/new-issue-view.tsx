"use client"

import Link from "next/link"
import { useRef, useState } from "react"
import { useQuery } from "@tanstack/react-query"
import {
  IconArrowLeft,
  IconChevronDown,
  IconDeviceFloppy,
  IconPlayerPlay,
} from "@tabler/icons-react"

import { runIssue, saveIssueDraft } from "@/app/issues/actions"
import { fetchNewIssueData } from "@/app/client-queries"
import type { ProjectOption } from "@/app/queries"
import { queryKeys, queryStaleTimes } from "@/app/query-keys"
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

import { AttachmentPromptField } from "../attachment-prompt-field"

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
  const [prompt, setPrompt] = useState("")
  const formRef = useRef<HTMLFormElement>(null)
  const agentProviderRef = useRef<HTMLInputElement>(null)
  const codexSubmitRef = useRef<HTMLButtonElement>(null)
  const setAgentProvider = (agentProvider: "claude_code" | "codex") => {
    if (agentProviderRef.current) {
      agentProviderRef.current.value = agentProvider
    }
  }

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
                ref={formRef}
                action={saveIssueDraft}
                encType="multipart/form-data"
                className="grid gap-5"
                id="new-issue-form"
              >
                <input
                  ref={agentProviderRef}
                  type="hidden"
                  name="agent_provider"
                  defaultValue="claude_code"
                />

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
                  <AttachmentPromptField
                    id="issue-prompt"
                    name="prompt"
                    value={prompt}
                    onChange={setPrompt}
                    rows={6}
                    placeholder="Describe the issue, acceptance notes, or links."
                    required
                  />
                </div>

                <div className="flex flex-col-reverse gap-2 sm:flex-row sm:flex-wrap sm:justify-end">
                  <Button asChild variant="outline" className="sm:w-auto">
                    <Link href="/issues">Cancel</Link>
                  </Button>
                  <Button
                    type="submit"
                    variant="secondary"
                    className="sm:w-auto"
                    onClick={() => {
                      setAgentProvider("claude_code")
                    }}
                  >
                    <IconDeviceFloppy />
                    Save draft
                  </Button>
                  <button
                    ref={codexSubmitRef}
                    type="submit"
                    formAction={runIssue}
                    className="hidden"
                    tabIndex={-1}
                    aria-hidden="true"
                  />
                  <div className="flex items-center">
                    <Button
                      type="submit"
                      formAction={runIssue}
                      className="min-w-0 flex-1 rounded-r-none border-r-primary-foreground/70 sm:flex-initial"
                      onClick={() => {
                        setAgentProvider("claude_code")
                      }}
                    >
                      <IconPlayerPlay />
                      <span className="truncate">Run with Claude Code</span>
                    </Button>
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <Button
                          type="button"
                          aria-label="Choose agent"
                          className="shrink-0 rounded-l-none border-l-primary-foreground/70 px-2"
                        >
                          <IconChevronDown />
                        </Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end" className="min-w-48">
                        <DropdownMenuItem
                          onSelect={() => {
                            setAgentProvider("codex")
                            formRef.current?.requestSubmit(
                              codexSubmitRef.current ?? undefined
                            )
                          }}
                        >
                          Run with Codex
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
