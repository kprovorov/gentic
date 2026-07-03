import type { Metadata } from "next"
import { redirect } from "next/navigation"
import { IconBrandGithub, IconPlus, IconTrash } from "@tabler/icons-react"

import {
  createProject,
  deleteProject,
  updateProject,
} from "@/app/settings/actions"
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
import { auth } from "@clerk/nextjs/server"
import { createClient } from "@gentic/supabase/server"

type Project = {
  id: string
  name: string
  repo: string
}

export const metadata: Metadata = {
  title: "Projects",
  description: "Configure the repositories Gentic can assign coding agents to.",
}

export default async function SettingsPage() {
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
      <div className="mx-auto flex w-full max-w-5xl flex-col gap-8">
        <header className="flex flex-col gap-2 border-b pb-6">
          <p className="text-sm font-medium text-muted-foreground">Settings</p>
          <h1 className="text-3xl">Projects</h1>
        </header>

        <section className="grid gap-6 lg:grid-cols-[minmax(0,360px)_1fr]">
          <Card>
            <CardHeader>
              <CardTitle>Add project</CardTitle>
              <CardDescription>
                Track a GitHub repository by its owner and repo name.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <form action={createProject} className="grid gap-4">
                <div className="grid gap-2">
                  <Label htmlFor="project-name">Name</Label>
                  <Input
                    id="project-name"
                    name="name"
                    placeholder="Gentic"
                    required
                    maxLength={120}
                  />
                </div>
                <div className="grid gap-2">
                  <Label htmlFor="project-repo">Repo</Label>
                  <Input
                    id="project-repo"
                    name="repo"
                    placeholder="kprovorov/gentic"
                    required
                    pattern="[A-Za-z0-9][A-Za-z0-9_.-]*/[A-Za-z0-9][A-Za-z0-9_.-]*"
                  />
                </div>
                <Button type="submit" className="mt-2">
                  <IconPlus />
                  Add project
                </Button>
              </form>
            </CardContent>
          </Card>

          <div className="flex flex-col gap-3">
            {projects.length === 0 ? (
              <div className="flex min-h-48 items-center justify-center rounded-lg border border-dashed p-8 text-center text-sm text-muted-foreground">
                No projects yet.
              </div>
            ) : (
              projects.map((project) => (
                <Card key={project.id}>
                  <CardContent className="p-4">
                    <form
                      key={`${project.name}-${project.repo}`}
                      action={updateProject}
                      className="grid gap-3"
                    >
                      <input type="hidden" name="id" value={project.id} />
                      <div className="grid gap-3 md:grid-cols-2">
                        <div className="grid gap-2">
                          <Label htmlFor={`name-${project.id}`}>Name</Label>
                          <Input
                            id={`name-${project.id}`}
                            name="name"
                            defaultValue={project.name}
                            required
                            maxLength={120}
                          />
                        </div>
                        <div className="grid gap-2">
                          <Label htmlFor={`repo-${project.id}`}>Repo</Label>
                          <div className="relative">
                            <IconBrandGithub className="absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" />
                            <Input
                              id={`repo-${project.id}`}
                              name="repo"
                              defaultValue={project.repo}
                              required
                              pattern="[A-Za-z0-9][A-Za-z0-9_.-]*/[A-Za-z0-9][A-Za-z0-9_.-]*"
                              className="pl-9"
                            />
                          </div>
                        </div>
                      </div>
                      <div className="flex gap-2">
                        <Button type="submit" variant="outline">
                          Save
                        </Button>
                        <Button
                          formAction={deleteProject}
                          variant="destructive"
                          size="icon"
                          aria-label={`Delete ${project.name}`}
                        >
                          <IconTrash />
                        </Button>
                      </div>
                    </form>
                  </CardContent>
                </Card>
              ))
            )}
          </div>
        </section>
      </div>
    </main>
  )
}
