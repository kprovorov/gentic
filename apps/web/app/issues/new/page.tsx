import Link from "next/link"
import { redirect } from "next/navigation"
import { IconArrowLeft, IconPlus } from "@tabler/icons-react"

import { createIssue } from "@/app/issues/actions"
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@gentic/ui/select"
import { auth } from "@clerk/nextjs/server"
import { createClient } from "@gentic/supabase/server"

type Project = {
  id: string
  name: string
  repo: string
}

export default async function NewIssuePage() {
  const { userId } = await auth()

  if (!userId) {
    redirect("/login")
  }

  const supabase = await createClient()
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
                  <Select
                    name="project_id"
                    required
                    defaultValue={projects[0]?.id}
                  >
                    <SelectTrigger id="issue-project">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {projects.map((project) => (
                        <SelectItem key={project.id} value={project.id}>
                          {project.name} ({project.repo})
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>

                <div className="grid gap-2">
                  <Label htmlFor="issue-title">Title</Label>
                  <Input
                    id="issue-title"
                    name="title"
                    placeholder="Review onboarding flow"
                    required
                    maxLength={160}
                  />
                </div>

                <div className="grid gap-2">
                  <Label htmlFor="issue-agent-provider">Agent</Label>
                  <Select
                    name="agent_provider"
                    required
                    defaultValue="claude_code"
                  >
                    <SelectTrigger id="issue-agent-provider">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="claude_code">Claude Code</SelectItem>
                      <SelectItem value="codex">Codex</SelectItem>
                    </SelectContent>
                  </Select>
                </div>

                <div className="grid gap-2">
                  <Label htmlFor="issue-prompt">Prompt</Label>
                  <textarea
                    id="issue-prompt"
                    name="prompt"
                    rows={6}
                    placeholder="Add context, acceptance notes, or links."
                    className="w-full resize-y rounded-3xl border border-transparent bg-input/50 px-3 py-2 text-base transition-[color,box-shadow,background-color] outline-none placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/30 md:text-sm"
                  />
                </div>

                <div className="grid gap-2">
                  <Label htmlFor="issue-status">Status</Label>
                  <Select
                    name="status"
                    required
                    defaultValue="draft"
                  >
                    <SelectTrigger id="issue-status">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="draft">Draft</SelectItem>
                      <SelectItem value="todo">Todo</SelectItem>
                      <SelectItem value="in-progress">In progress</SelectItem>
                      <SelectItem value="waiting-for-input">
                        Waiting for input
                      </SelectItem>
                      <SelectItem value="testing">Testing</SelectItem>
                      <SelectItem value="tests-failed">Tests failed</SelectItem>
                      <SelectItem value="ready-for-review">
                        Ready for review
                      </SelectItem>
                      <SelectItem value="changes-requested">
                        Changes requested
                      </SelectItem>
                      <SelectItem value="approved">Approved</SelectItem>
                      <SelectItem value="merged">Merged</SelectItem>
                      <SelectItem value="deploying">Deploying</SelectItem>
                      <SelectItem value="deploy-failed">
                        Deploy failed
                      </SelectItem>
                      <SelectItem value="validating">Validating</SelectItem>
                      <SelectItem value="completed">Completed</SelectItem>
                      <SelectItem value="cancelled">Cancelled</SelectItem>
                    </SelectContent>
                  </Select>
                </div>

                <div className="flex justify-end gap-2">
                  <Button asChild variant="outline">
                    <Link href="/home">Cancel</Link>
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
    </main>
  )
}
