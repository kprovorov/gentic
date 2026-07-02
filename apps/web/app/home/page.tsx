import type { Metadata } from "next"
import Link from "next/link"
import { redirect } from "next/navigation"
import {
  IconCircleCheck,
  IconCircleDashed,
  IconClock,
  IconPencil,
  IconPlus,
} from "@tabler/icons-react"

import { Button } from "@gentic/ui/button"
import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@gentic/ui/card"
import { createClient } from "@gentic/supabase/server"
import { cn } from "@gentic/ui/utils"

type IssueStatus = "draft" | "todo" | "in-progress" | "done"

type Issue = {
  id: string
  title: string
  description: string | null
  status: IssueStatus
  created_at: string
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

function formatDate(value: string) {
  return new Intl.DateTimeFormat("en", {
    month: "short",
    day: "numeric",
    year: "numeric",
  }).format(new Date(value))
}

export const metadata: Metadata = {
  title: "Home",
}

export default async function HomePage() {
  const supabase = await createClient()
  const { data } = await supabase.auth.getClaims()

  if (!data?.claims) {
    redirect("/login")
  }

  const { data: issues, error } = await supabase
    .from("issues")
    .select("id,title,description,status,created_at,projects(id,name,repo)")
    .order("created_at", { ascending: false })
    .returns<Issue[]>()

  if (error) {
    throw new Error(error.message)
  }

  return (
    <main className="min-h-svh bg-background px-4 py-8 md:px-8">
      <div className="mx-auto flex w-full max-w-5xl flex-col gap-8">
        <header className="flex flex-col gap-4 border-b pb-6 md:flex-row md:items-end md:justify-between">
          <div className="grid gap-2">
            <p className="text-sm font-medium text-muted-foreground">Home</p>
            <h1 className="text-3xl">Issues</h1>
          </div>
          <Button asChild>
            <Link href="/issues/new">
              <IconPlus />
              New issue
            </Link>
          </Button>
        </header>

        {issues.length === 0 ? (
          <section className="flex min-h-72 flex-col items-center justify-center gap-4 rounded-lg border border-dashed p-8 text-center">
            <div className="grid gap-1">
              <h2 className="text-xl">No issues yet</h2>
              <p className="max-w-md text-sm text-muted-foreground">
                Create an issue and attach it to one of your projects.
              </p>
            </div>
            <Button asChild variant="outline">
              <Link href="/issues/new">
                <IconPlus />
                Create issue
              </Link>
            </Button>
          </section>
        ) : (
          <section className="grid gap-3">
            {issues.map((issue) => {
              const StatusIcon = statusIcons[issue.status]

              return (
                <Card key={issue.id} size="sm">
                  <CardHeader>
                    <CardTitle>
                      <Link
                        href={`/issues/${issue.id}`}
                        className="hover:text-primary"
                      >
                        {issue.title}
                      </Link>
                    </CardTitle>
                    <CardDescription>
                      {issue.projects?.name ?? "Unknown project"} ·{" "}
                      {formatDate(issue.created_at)}
                    </CardDescription>
                    <CardAction>
                      <span
                        className={cn(
                          "inline-flex h-7 items-center gap-1 rounded-full px-2.5 text-xs font-medium",
                          statusStyles[issue.status]
                        )}
                      >
                        <StatusIcon className="size-3.5" />
                        {statusLabels[issue.status]}
                      </span>
                    </CardAction>
                  </CardHeader>
                  {issue.description ? (
                    <CardContent>
                      <p className="line-clamp-2 text-sm text-muted-foreground">
                        {issue.description}
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
