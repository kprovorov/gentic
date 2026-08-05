"use client"

import Link from "next/link"
import { useState } from "react"
import { useQuery } from "@tanstack/react-query"
import { IconArrowLeft, IconDeviceFloppy } from "@tabler/icons-react"

import { fetchIssueEditData } from "@/app/client-queries"
import { updateIssue } from "@/app/issues/actions"
import { getIssueHref } from "@/app/issues/urls"
import type { IssueEdit } from "@/app/queries"
import { queryKeys, queryStaleTimes } from "@/app/query-keys"
import { Button } from "@gentic/ui/button"
import {
  agentModelOptions,
  issuePriorityOptions,
  type AgentProvider,
} from "@gentic/validators/issues"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@gentic/ui/card"
import { Input } from "@gentic/ui/input"
import { Label } from "@gentic/ui/label"
import { NativeSelect, NativeSelectOption } from "@gentic/ui/native-select"

import { AutomaticPrPreferenceField } from "../../automatic-pr-preference-field"

export function EditIssueView({
  issueId,
  initialData,
}: {
  issueId: string
  initialData: IssueEdit
}) {
  const { data: issue } = useQuery({
    queryKey: queryKeys.issueEdit(issueId),
    queryFn: () => fetchIssueEditData(issueId),
    initialData,
    staleTime: queryStaleTimes.formOptions,
  })
  const issueHref = getIssueHref(issue) ?? "/issues"
  const [agentProvider, setAgentProvider] = useState<AgentProvider>(
    issue.agent_provider
  )
  const [issueModel, setIssueModel] = useState<string | null>(issue.issue_model)

  return (
    <div className="bg-background px-4 py-8 md:px-8">
      <div className="mx-auto flex w-full max-w-3xl flex-col gap-8">
        <header className="flex flex-col gap-4 border-b pb-6">
          <Button asChild variant="ghost" className="w-fit">
            <Link href={issueHref}>
              <IconArrowLeft />
              Back
            </Link>
          </Button>
          <div className="grid gap-2">
            <p className="text-sm font-medium text-muted-foreground">Issues</p>
            <h1 className="text-3xl">Edit issue</h1>
          </div>
        </header>

        <Card>
          <CardHeader>
            <CardTitle>Edit issue</CardTitle>
            <CardDescription>Update the title and body.</CardDescription>
          </CardHeader>
          <CardContent>
            <form action={updateIssue} className="grid gap-5">
              <input type="hidden" name="id" value={issue.id} />

              <div className="grid gap-2">
                <Label htmlFor="issue-title">Title</Label>
                <Input
                  id="issue-title"
                  name="title"
                  defaultValue={issue.title ?? ""}
                  placeholder="Review onboarding flow"
                  required
                  maxLength={160}
                />
              </div>

              <div className="grid gap-2">
                <Label htmlFor="issue-body">Body</Label>
                <textarea
                  id="issue-body"
                  name="body"
                  rows={6}
                  defaultValue={issue.body ?? ""}
                  placeholder="Add context, acceptance notes, or links."
                  className="w-full resize-y rounded-3xl border border-transparent bg-input/50 px-3 py-2 text-base transition-[color,box-shadow,background-color] outline-none placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/30 md:text-sm"
                />
              </div>

              <div className="grid gap-2">
                <Label htmlFor="issue-type">Type</Label>
                <NativeSelect
                  name="type"
                  required
                  defaultValue={issue.type}
                  id="issue-type"
                  className="w-full"
                >
                  <NativeSelectOption value="issue">Issue</NativeSelectOption>
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
                <Label htmlFor="issue-priority">Priority</Label>
                <NativeSelect
                  name="priority"
                  required
                  defaultValue={issue.priority}
                  id="issue-priority"
                  className="w-full"
                >
                  {issuePriorityOptions.map((option) => (
                    <NativeSelectOption key={option.value} value={option.value}>
                      {option.label}
                    </NativeSelectOption>
                  ))}
                </NativeSelect>
              </div>

              <div className="grid gap-2">
                <Label htmlFor="issue-agent-provider">Agent</Label>
                <NativeSelect
                  name="agent_provider"
                  required
                  value={agentProvider}
                  id="issue-agent-provider"
                  className="w-full"
                  onChange={(event) => {
                    const nextProvider = event.target.value as AgentProvider
                    setAgentProvider(nextProvider)
                    setIssueModel(null)
                  }}
                >
                  <NativeSelectOption value="claude_code">
                    Claude Code
                  </NativeSelectOption>
                  <NativeSelectOption value="codex">Codex</NativeSelectOption>
                </NativeSelect>
              </div>

              <div className="grid gap-2">
                <Label htmlFor="issue-model">Model</Label>
                <NativeSelect
                  name="issue_model"
                  value={issueModel ?? ""}
                  id="issue-model"
                  className="w-full"
                  onChange={(event) =>
                    setIssueModel(event.target.value || null)
                  }
                >
                  <NativeSelectOption value="">
                    Default model
                  </NativeSelectOption>
                  {agentModelOptions[agentProvider].map((option) => (
                    <NativeSelectOption key={option.value} value={option.value}>
                      {option.label}
                    </NativeSelectOption>
                  ))}
                </NativeSelect>
              </div>

              <AutomaticPrPreferenceField
                key={`${issue.id}-${issue.create_pr_automatically}-${issue.has_attached_pull_request}`}
                defaultChecked={issue.create_pr_automatically}
                disabled={issue.has_attached_pull_request}
              />

              <div className="flex justify-end gap-2">
                <Button asChild variant="outline">
                  <Link href={issueHref}>Cancel</Link>
                </Button>
                <Button type="submit">
                  <IconDeviceFloppy />
                  Save changes
                </Button>
              </div>
            </form>
          </CardContent>
        </Card>
      </div>
    </div>
  )
}
