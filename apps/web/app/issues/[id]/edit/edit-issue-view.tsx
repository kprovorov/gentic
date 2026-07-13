"use client"

import Link from "next/link"
import { useQuery } from "@tanstack/react-query"
import { IconArrowLeft, IconDeviceFloppy } from "@tabler/icons-react"

import { updateIssue } from "@/app/issues/actions"
import { getIssueEditData, type IssueEdit } from "@/app/queries"
import { queryKeys } from "@/app/query-keys"
import { Button } from "@gentic/ui/button"
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

export function EditIssueView({
  issueId,
  initialData,
}: {
  issueId: string
  initialData: IssueEdit
}) {
  const { data: issue } = useQuery({
    queryKey: queryKeys.issueEdit(issueId),
    queryFn: () => getIssueEditData(issueId),
    initialData,
  })

  return (
    <div className="bg-background px-4 py-8 md:px-8">
      <div className="mx-auto flex w-full max-w-3xl flex-col gap-8">
        <header className="flex flex-col gap-4 border-b pb-6">
          <Button asChild variant="ghost" className="w-fit">
            <Link href={`/issues/${issue.id}`}>
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
            <CardDescription>Update the title and prompt.</CardDescription>
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
                <Label htmlFor="issue-prompt">Prompt</Label>
                <textarea
                  id="issue-prompt"
                  name="prompt"
                  rows={6}
                  defaultValue={issue.prompt ?? ""}
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
                  defaultValue={issue.agent_provider}
                  id="issue-agent-provider"
                  className="w-full"
                >
                  <NativeSelectOption value="claude_code">
                    Claude Code
                  </NativeSelectOption>
                  <NativeSelectOption value="codex">Codex</NativeSelectOption>
                </NativeSelect>
              </div>

              <div className="flex justify-end gap-2">
                <Button asChild variant="outline">
                  <Link href={`/issues/${issue.id}`}>Cancel</Link>
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
