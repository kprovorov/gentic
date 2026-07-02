import Link from "next/link"
import { notFound, redirect } from "next/navigation"
import {
  IconArrowLeft,
  IconCircleCheck,
  IconCircleDashed,
  IconClock,
  IconExternalLink,
  IconPencil,
} from "@tabler/icons-react"

import { Button } from "@gentic/ui/button"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@gentic/ui/card"
import { createClient } from "@gentic/supabase/server"
import { cn } from "@gentic/ui/utils"

import { IssueStatusSelect } from "./issue-status-select"

type IssueStatus = "draft" | "todo" | "in-progress" | "done"

type Issue = {
  id: string
  title: string
  description: string | null
  status: IssueStatus
  created_at: string
  updated_at: string
  projects: {
    id: string
    name: string
    repo: string
  } | null
}

const statusLabels: Record<IssueStatus, string> = {
  draft: "Draft",
  todo: "Todo",
  "in-progress": "In progress",
  done: "Done",
}

const statusStyles: Record<IssueStatus, string> = {
  draft: "bg-muted/60 text-muted-foreground",
  todo: "bg-muted text-muted-foreground",
  "in-progress": "bg-primary/15 text-primary-foreground",
  done: "bg-emerald-500/15 text-emerald-700 dark:text-emerald-300",
}

const statusIcons = {
  draft: IconPencil,
  todo: IconCircleDashed,
  "in-progress": IconClock,
  done: IconCircleCheck,
}

function formatDateTime(value: string) {
  return new Intl.DateTimeFormat("en", {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(new Date(value))
}

export default async function IssueDetailPage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const { id } = await params
  const supabase = await createClient()
  const { data } = await supabase.auth.getClaims()

  if (!data?.claims) {
    redirect("/login")
  }

  const { data: issue, error } = await supabase
    .from("issues")
    .select(
      "id,title,description,status,created_at,updated_at,projects(id,name,repo)"
    )
    .eq("id", id)
    .maybeSingle()
    .returns<Issue | null>()

  if (error) {
    throw new Error(error.message)
  }

  if (!issue) {
    notFound()
  }

  const StatusIcon = statusIcons[issue.status]

  return (
    <main className="min-h-svh bg-background px-4 py-8 md:px-8">
      <div className="mx-auto flex w-full max-w-3xl flex-col gap-8">
        <header className="flex flex-col gap-4 border-b pb-6">
          <Button asChild variant="ghost" className="w-fit">
            <Link href="/home">
              <IconArrowLeft />
              Back
            </Link>
          </Button>
          <div className="grid gap-3">
            <div
              className={cn(
                "inline-flex h-7 w-fit items-center gap-1 rounded-full px-2.5 text-xs font-medium",
                statusStyles[issue.status]
              )}
            >
              <StatusIcon className="size-3.5" />
              {statusLabels[issue.status]}
            </div>
            <h1 className="text-3xl">{issue.title}</h1>
          </div>
        </header>

        <section className="grid gap-4">
          <Card>
            <CardHeader>
              <CardTitle>Status</CardTitle>
              <CardDescription>
                Update where this issue stands.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <IssueStatusSelect issueId={issue.id} status={issue.status} />
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Description</CardTitle>
              <CardDescription>
                Created {formatDateTime(issue.created_at)}
              </CardDescription>
            </CardHeader>
            <CardContent>
              {issue.description ? (
                <p className="text-sm whitespace-pre-wrap text-muted-foreground">
                  {issue.description}
                </p>
              ) : (
                <p className="text-sm text-muted-foreground">
                  No description provided.
                </p>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Project</CardTitle>
              <CardDescription>
                Last updated {formatDateTime(issue.updated_at)}
              </CardDescription>
            </CardHeader>
            <CardContent>
              {issue.projects ? (
                <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                  <div>
                    <p className="font-medium">{issue.projects.name}</p>
                    <p className="text-sm text-muted-foreground">
                      {issue.projects.repo}
                    </p>
                  </div>
                  <Button asChild variant="outline">
                    <Link
                      href={`https://github.com/${issue.projects.repo}`}
                      target="_blank"
                      rel="noreferrer"
                    >
                      <IconExternalLink />
                      Open repo
                    </Link>
                  </Button>
                </div>
              ) : (
                <p className="text-sm text-muted-foreground">
                  This issue is not linked to an available project.
                </p>
              )}
            </CardContent>
          </Card>
        </section>
      </div>
    </main>
  )
}
