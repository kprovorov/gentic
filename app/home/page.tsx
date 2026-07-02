import Link from "next/link"
import { redirect } from "next/navigation"
import {
  IconCircleCheck,
  IconCircleDashed,
  IconClock,
  IconPlus,
} from "@tabler/icons-react"

import { Button } from "@/components/ui/button"
import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import { createClient } from "@/lib/supabase/server"
import { cn } from "@/lib/utils"

type TaskStatus = "todo" | "in-progress" | "done"

type Task = {
  id: string
  title: string
  description: string | null
  status: TaskStatus
  created_at: string
  projects: {
    id: string
    name: string
    repo: string
  } | null
}

const statusLabels: Record<TaskStatus, string> = {
  todo: "Todo",
  "in-progress": "In progress",
  done: "Done",
}

const statusStyles: Record<TaskStatus, string> = {
  todo: "bg-muted text-muted-foreground",
  "in-progress": "bg-primary/15 text-primary-foreground",
  done: "bg-emerald-500/15 text-emerald-700 dark:text-emerald-300",
}

const statusIcons = {
  todo: IconCircleDashed,
  "in-progress": IconClock,
  done: IconCircleCheck,
}

function formatDate(value: string) {
  return new Intl.DateTimeFormat("en", {
    month: "short",
    day: "numeric",
    year: "numeric",
  }).format(new Date(value))
}

export default async function HomePage() {
  const supabase = await createClient()
  const { data } = await supabase.auth.getClaims()

  if (!data?.claims) {
    redirect("/login")
  }

  const { data: tasks, error } = await supabase
    .from("tasks")
    .select("id,title,description,status,created_at,projects(id,name,repo)")
    .order("created_at", { ascending: false })
    .returns<Task[]>()

  if (error) {
    throw new Error(error.message)
  }

  return (
    <main className="min-h-svh bg-background px-4 py-8 md:px-8">
      <div className="mx-auto flex w-full max-w-5xl flex-col gap-8">
        <header className="flex flex-col gap-4 border-b pb-6 md:flex-row md:items-end md:justify-between">
          <div className="grid gap-2">
            <p className="text-sm font-medium text-muted-foreground">Home</p>
            <h1 className="text-3xl">Tasks</h1>
          </div>
          <Button asChild>
            <Link href="/tasks/new">
              <IconPlus />
              New task
            </Link>
          </Button>
        </header>

        {tasks.length === 0 ? (
          <section className="flex min-h-72 flex-col items-center justify-center gap-4 rounded-lg border border-dashed p-8 text-center">
            <div className="grid gap-1">
              <h2 className="text-xl">No tasks yet</h2>
              <p className="max-w-md text-sm text-muted-foreground">
                Create a task and attach it to one of your projects.
              </p>
            </div>
            <Button asChild variant="outline">
              <Link href="/tasks/new">
                <IconPlus />
                Create task
              </Link>
            </Button>
          </section>
        ) : (
          <section className="grid gap-3">
            {tasks.map((task) => {
              const StatusIcon = statusIcons[task.status]

              return (
                <Card key={task.id} size="sm">
                  <CardHeader>
                    <CardTitle>
                      <Link
                        href={`/tasks/${task.id}`}
                        className="hover:text-primary"
                      >
                        {task.title}
                      </Link>
                    </CardTitle>
                    <CardDescription>
                      {task.projects?.name ?? "Unknown project"} ·{" "}
                      {formatDate(task.created_at)}
                    </CardDescription>
                    <CardAction>
                      <span
                        className={cn(
                          "inline-flex h-7 items-center gap-1 rounded-full px-2.5 text-xs font-medium",
                          statusStyles[task.status]
                        )}
                      >
                        <StatusIcon className="size-3.5" />
                        {statusLabels[task.status]}
                      </span>
                    </CardAction>
                  </CardHeader>
                  {task.description ? (
                    <CardContent>
                      <p className="line-clamp-2 text-sm text-muted-foreground">
                        {task.description}
                      </p>
                    </CardContent>
                  ) : null}
                </Card>
              )
            })}
          </section>
        )}
      </div>
    </main>
  )
}
