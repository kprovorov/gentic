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

import { Button } from "@/components/ui/button"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import { createClient } from "@/lib/supabase/server"
import { cn } from "@/lib/utils"

import { TaskStatusSelect } from "./task-status-select"

type TaskStatus = "draft" | "todo" | "in-progress" | "done"

type Task = {
  id: string
  title: string
  description: string | null
  status: TaskStatus
  created_at: string
  updated_at: string
  projects: {
    id: string
    name: string
    repo: string
  } | null
}

const statusLabels: Record<TaskStatus, string> = {
  draft: "Draft",
  todo: "Todo",
  "in-progress": "In progress",
  done: "Done",
}

const statusStyles: Record<TaskStatus, string> = {
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

export default async function TaskDetailPage({
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

  const { data: task, error } = await supabase
    .from("tasks")
    .select(
      "id,title,description,status,created_at,updated_at,projects(id,name,repo)"
    )
    .eq("id", id)
    .maybeSingle()
    .returns<Task | null>()

  if (error) {
    throw new Error(error.message)
  }

  if (!task) {
    notFound()
  }

  const StatusIcon = statusIcons[task.status]

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
                statusStyles[task.status]
              )}
            >
              <StatusIcon className="size-3.5" />
              {statusLabels[task.status]}
            </div>
            <h1 className="text-3xl">{task.title}</h1>
          </div>
        </header>

        <section className="grid gap-4">
          <Card>
            <CardHeader>
              <CardTitle>Status</CardTitle>
              <CardDescription>
                Update where this task stands.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <TaskStatusSelect taskId={task.id} status={task.status} />
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Description</CardTitle>
              <CardDescription>
                Created {formatDateTime(task.created_at)}
              </CardDescription>
            </CardHeader>
            <CardContent>
              {task.description ? (
                <p className="text-sm whitespace-pre-wrap text-muted-foreground">
                  {task.description}
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
                Last updated {formatDateTime(task.updated_at)}
              </CardDescription>
            </CardHeader>
            <CardContent>
              {task.projects ? (
                <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                  <div>
                    <p className="font-medium">{task.projects.name}</p>
                    <p className="text-sm text-muted-foreground">
                      {task.projects.repo}
                    </p>
                  </div>
                  <Button asChild variant="outline">
                    <Link
                      href={`https://github.com/${task.projects.repo}`}
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
                  This task is not linked to an available project.
                </p>
              )}
            </CardContent>
          </Card>
        </section>
      </div>
    </main>
  )
}
