"use client"

import Link from "next/link"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
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
import { fetchSettingsData } from "@/app/client-queries"
import type { SettingsData } from "@/app/queries"
import { queryKeys, queryStaleTimes } from "@/app/query-keys"
import { Button } from "@gentic/ui/button"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@gentic/ui/card"
import { Checkbox } from "@gentic/ui/checkbox"
import { Input } from "@gentic/ui/input"
import { Label } from "@gentic/ui/label"
import { Textarea } from "@gentic/ui/textarea"

export function SettingsView({ initialData }: { initialData: SettingsData }) {
  const queryClient = useQueryClient()
  const { data } = useQuery({
    queryKey: queryKeys.settings,
    queryFn: fetchSettingsData,
    initialData,
    staleTime: queryStaleTimes.settings,
  })
  const invalidateProjects = async () => {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: queryKeys.settings }),
      queryClient.invalidateQueries({ queryKey: queryKeys.newIssue }),
    ])
  }
  const createProjectMutation = useMutation({
    mutationFn: createProject,
    onSuccess: invalidateProjects,
  })
  const updateProjectMutation = useMutation({
    mutationFn: updateProject,
    onSuccess: invalidateProjects,
  })
  const deleteProjectMutation = useMutation({
    mutationFn: deleteProject,
    onSuccess: invalidateProjects,
  })
  const disconnectGithubMutation = useMutation({
    mutationFn: disconnectGithubIntegration,
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: queryKeys.settings })
    },
  })
  const { projects, githubIntegration, githubAppConfigured } = data

  function submitCreateProject(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    createProjectMutation.mutate(new FormData(event.currentTarget), {
      onSuccess: () => event.currentTarget.reset(),
    })
  }

  function submitUpdateProject(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    updateProjectMutation.mutate(new FormData(event.currentTarget))
  }

  function submitDeleteProject(projectId: string) {
    const formData = new FormData()
    formData.set("id", projectId)
    deleteProjectMutation.mutate(formData)
  }

  function submitDisconnectGithub(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    disconnectGithubMutation.mutate()
  }

  return (
    <div className="bg-background px-4 py-8 md:px-8">
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
                <form onSubmit={submitDisconnectGithub}>
                  <Button
                    type="submit"
                    variant="outline"
                    disabled={disconnectGithubMutation.isPending}
                  >
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
              <form onSubmit={submitCreateProject} className="grid gap-4">
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
                <div className="flex items-center gap-2">
                  <Checkbox
                    id="project-auto-respond"
                    name="auto_respond_to_reviews"
                    defaultChecked
                  />
                  <Label
                    htmlFor="project-auto-respond"
                    className="font-normal"
                  >
                    Auto-respond to review feedback
                  </Label>
                </div>
                <Button
                  type="submit"
                  className="mt-2"
                  disabled={createProjectMutation.isPending}
                >
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
                      onSubmit={submitUpdateProject}
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
                      <div className="flex items-center gap-2">
                        <Checkbox
                          id={`auto-respond-${project.id}`}
                          name="auto_respond_to_reviews"
                          defaultChecked={project.auto_respond_to_reviews}
                        />
                        <Label
                          htmlFor={`auto-respond-${project.id}`}
                          className="font-normal"
                        >
                          Auto-respond to review feedback
                        </Label>
                      </div>
                      <div className="flex gap-2">
                        <Button
                          type="submit"
                          variant="outline"
                          disabled={updateProjectMutation.isPending}
                        >
                          Save
                        </Button>
                        <Button
                          type="button"
                          variant="destructive"
                          size="icon"
                          aria-label={`Delete ${project.name}`}
                          disabled={deleteProjectMutation.isPending}
                          onClick={() => submitDeleteProject(project.id)}
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
    </div>
  )
}
