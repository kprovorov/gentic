import type { Metadata } from "next"
import Link from "next/link"
import { redirect } from "next/navigation"
import {
  IconBrandGithub,
  IconCheck,
  IconExternalLink,
  IconPlugConnected,
  IconPlus,
  IconTrash,
} from "@tabler/icons-react"

import {
  createProject,
  deleteProject,
  disconnectGithubIntegration,
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
import { Textarea } from "@gentic/ui/textarea"
import { auth } from "@clerk/nextjs/server"
import { createClient } from "@gentic/supabase/server"
import * as githubIntegrationsService from "@gentic/services/github-integrations"

type Project = {
  id: string
  name: string
  repo: string
  setup_script: string | null
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
    .select("id,name,repo,setup_script")
    .order("created_at", { ascending: false })
    .returns<Project[]>()

  if (error) {
    throw new Error(error.message)
  }

  const githubIntegration =
    await githubIntegrationsService.getGithubIntegration(supabase, userId)
  const githubAppConfigured = Boolean(process.env.GITHUB_APP_SLUG)

  return (
    <main className="min-h-svh bg-background px-4 py-8 md:px-8">
      <div className="mx-auto flex w-full max-w-5xl flex-col gap-8">
        <header className="flex flex-col gap-2 border-b pb-6">
          <p className="text-sm font-medium text-muted-foreground">Settings</p>
          <h1 className="text-3xl">Workspace</h1>
        </header>

        <Card>
          <CardHeader>
            <div className="flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
              <div className="flex gap-3">
                <div className="flex size-10 shrink-0 items-center justify-center rounded-md border bg-muted">
                  <IconBrandGithub className="size-5" />
                </div>
                <div className="grid gap-1">
                  <CardTitle>GitHub integration</CardTitle>
                  <CardDescription>
                    Connect a GitHub App installation for repository and pull
                    request automation.
                  </CardDescription>
                </div>
              </div>
              {githubIntegration?.status === "connected" ? (
                <div className="inline-flex items-center gap-1.5 rounded-md border border-green-600/30 bg-green-600/10 px-2.5 py-1 text-sm text-green-700 dark:text-green-400">
                  <IconCheck className="size-4" />
                  Connected
                </div>
              ) : githubIntegration?.status === "pending" ? (
                <div className="inline-flex items-center gap-1.5 rounded-md border px-2.5 py-1 text-sm text-muted-foreground">
                  <IconPlugConnected className="size-4" />
                  Pending approval
                </div>
              ) : (
                <div className="inline-flex items-center gap-1.5 rounded-md border px-2.5 py-1 text-sm text-muted-foreground">
                  Not connected
                </div>
              )}
            </div>
          </CardHeader>
          <CardContent className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
            <div className="text-sm text-muted-foreground">
              {githubIntegration?.status === "connected"
                ? `Installation ${githubIntegration.installation_id} is ready for future pull request status updates.`
                : githubIntegration?.status === "pending"
                  ? "GitHub recorded an install request that still needs organization approval."
                  : githubAppConfigured
                    ? "Install the configured GitHub App on the repositories Gentic should access."
                    : "Set GITHUB_APP_SLUG before connecting a GitHub App."}
            </div>
            <div className="flex shrink-0 gap-2">
              {githubIntegration ? (
                <form action={disconnectGithubIntegration}>
                  <Button type="submit" variant="outline">
                    Disconnect
                  </Button>
                </form>
              ) : !githubAppConfigured ? (
                <Button disabled>
                  <IconExternalLink />
                  Connect GitHub
                </Button>
              ) : (
                <Button asChild>
                  <Link href="/api/integrations/github/setup">
                    <IconExternalLink />
                    Connect GitHub
                  </Link>
                </Button>
              )}
            </div>
          </CardContent>
        </Card>

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
                <div className="grid gap-2">
                  <Label htmlFor="project-setup-script">
                    Setup script (optional)
                  </Label>
                  <Textarea
                    id="project-setup-script"
                    name="setup_script"
                    placeholder="npm install"
                    rows={4}
                    className="font-mono"
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
                      <div className="grid gap-2">
                        <Label htmlFor={`setup-script-${project.id}`}>
                          Setup script (optional)
                        </Label>
                        <Textarea
                          id={`setup-script-${project.id}`}
                          name="setup_script"
                          defaultValue={project.setup_script ?? ""}
                          placeholder="npm install"
                          rows={4}
                          className="font-mono"
                        />
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
