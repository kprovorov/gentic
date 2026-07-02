import Link from "next/link"
import { redirect } from "next/navigation"
import { IconArrowLeft, IconPlus } from "@tabler/icons-react"

import { createTask } from "@/app/tasks/actions"
import { Button } from "@/components/ui/button"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { createClient } from "@/lib/supabase/server"

type Project = {
  id: string
  name: string
  repo: string
}

export default async function NewTaskPage() {
  const supabase = await createClient()
  const { data } = await supabase.auth.getClaims()

  if (!data?.claims) {
    redirect("/login")
  }

  const { data: projects, error } = await supabase
    .from("projects")
    .select("id,name,repo")
    .order("created_at", { ascending: false })
    .returns<Project[]>()

  if (error) {
    throw new Error(error.message)
  }

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
          <div className="grid gap-2">
            <p className="text-sm font-medium text-muted-foreground">Tasks</p>
            <h1 className="text-3xl">New task</h1>
          </div>
        </header>

        <Card>
          <CardHeader>
            <CardTitle>Create task</CardTitle>
            <CardDescription>
              Add a task to one of your tracked projects.
            </CardDescription>
          </CardHeader>
          <CardContent>
            {projects.length === 0 ? (
              <div className="grid gap-4 rounded-lg border border-dashed p-6 text-center">
                <p className="text-sm text-muted-foreground">
                  Create a project before adding tasks.
                </p>
                <Button asChild variant="outline" className="mx-auto">
                  <Link href="/settings">Go to projects</Link>
                </Button>
              </div>
            ) : (
              <form action={createTask} className="grid gap-5">
                <div className="grid gap-2">
                  <Label htmlFor="task-project">Project</Label>
                  <select
                    id="task-project"
                    name="project_id"
                    required
                    className="h-9 w-full rounded-3xl border border-transparent bg-input/50 px-3 text-sm transition-[color,box-shadow,background-color] outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/30"
                    defaultValue={projects[0]?.id}
                  >
                    {projects.map((project) => (
                      <option key={project.id} value={project.id}>
                        {project.name} ({project.repo})
                      </option>
                    ))}
                  </select>
                </div>

                <div className="grid gap-2">
                  <Label htmlFor="task-title">Title</Label>
                  <Input
                    id="task-title"
                    name="title"
                    placeholder="Review onboarding flow"
                    required
                    maxLength={160}
                  />
                </div>

                <div className="grid gap-2">
                  <Label htmlFor="task-description">Description</Label>
                  <textarea
                    id="task-description"
                    name="description"
                    rows={6}
                    placeholder="Add context, acceptance notes, or links."
                    className="w-full resize-y rounded-3xl border border-transparent bg-input/50 px-3 py-2 text-base transition-[color,box-shadow,background-color] outline-none placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/30 md:text-sm"
                  />
                </div>

                <div className="grid gap-2">
                  <Label htmlFor="task-status">Status</Label>
                  <select
                    id="task-status"
                    name="status"
                    required
                    defaultValue="todo"
                    className="h-9 w-full rounded-3xl border border-transparent bg-input/50 px-3 text-sm transition-[color,box-shadow,background-color] outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/30"
                  >
                    <option value="draft">Draft</option>
                    <option value="todo">Todo</option>
                    <option value="in-progress">In progress</option>
                    <option value="done">Done</option>
                  </select>
                </div>

                <div className="flex justify-end gap-2">
                  <Button asChild variant="outline">
                    <Link href="/home">Cancel</Link>
                  </Button>
                  <Button type="submit">
                    <IconPlus />
                    Create task
                  </Button>
                </div>
              </form>
            )}
          </CardContent>
        </Card>
      </div>
    </main>
  )
}
