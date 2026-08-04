"use client"

import Link from "next/link"
import * as React from "react"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import {
  IconAlertCircle,
  IconCheck,
  IconChevronDown,
  IconExternalLink,
  IconPlugConnected,
  IconPlus,
  IconSearch,
  IconTag,
  IconTrash,
} from "@tabler/icons-react"

import {
  createProject,
  deleteProject,
  disconnectGithubIntegration,
  updateDefaultAgent,
  updateProject,
} from "@/app/settings/actions"
import { ConnectedWorkersSection } from "@/app/settings/connected-workers-section"
import {
  agentProviderLabels,
  agentProviderOptions,
} from "@/app/issues/agent-provider-options"
import {
  fetchSettingsData,
  fetchSettingsWorkersData,
} from "@/app/client-queries"
import type { SettingsData } from "@/app/queries"
import { queryKeys, queryStaleTimes } from "@/app/query-keys"
import { AgentProviderIcon, BrandIcon } from "@/components/agent-provider-icon"
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
import { NativeSelect, NativeSelectOption } from "@gentic/ui/native-select"
import { Textarea } from "@gentic/ui/textarea"
import { cn } from "@gentic/ui/utils"

export function SettingsView({ initialData }: { initialData: SettingsData }) {
  const queryClient = useQueryClient()
  const [selectedRepo, setSelectedRepo] = React.useState("")
  const [repoQuery, setRepoQuery] = React.useState("")
  const { data } = useQuery({
    queryKey: queryKeys.settings,
    queryFn: fetchSettingsData,
    initialData,
    staleTime: queryStaleTimes.settings,
  })
  const workersQuery = useQuery({
    queryKey: queryKeys.settingsWorkers,
    queryFn: fetchSettingsWorkersData,
    refetchInterval: queryStaleTimes.settingsWorkersPoll,
  })
  const invalidateProjects = async () => {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: queryKeys.settings }),
      queryClient.invalidateQueries({ queryKey: queryKeys.settingsWorkers }),
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
  const updateDefaultAgentMutation = useMutation({
    mutationFn: updateDefaultAgent,
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: queryKeys.settings }),
        queryClient.invalidateQueries({ queryKey: queryKeys.newIssue }),
      ])
    },
  })
  const deleteProjectMutation = useMutation({
    mutationFn: deleteProject,
    onSuccess: invalidateProjects,
  })
  const disconnectGithubMutation = useMutation({
    mutationFn: disconnectGithubIntegration,
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: queryKeys.settings }),
        queryClient.invalidateQueries({ queryKey: queryKeys.settingsWorkers }),
      ])
    },
  })
  const {
    projects,
    githubIntegration,
    githubAppConfigured,
    githubRepositories,
    githubRepositoriesError,
  } = data
  const isGithubConnected =
    githubIntegration?.status === "connected" &&
    Boolean(githubIntegration.installation_id)
  const canCreateProject =
    isGithubConnected &&
    githubRepositories.length > 0 &&
    Boolean(selectedRepo) &&
    !createProjectMutation.isPending

  function submitCreateProject(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!selectedRepo) {
      return
    }

    createProjectMutation.mutate(new FormData(event.currentTarget), {
      onSuccess: () => {
        event.currentTarget.reset()
        setSelectedRepo("")
        setRepoQuery("")
      },
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

  function submitUpdateDefaultAgent(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    updateDefaultAgentMutation.mutate(new FormData(event.currentTarget))
  }

  return (
    <div className="bg-background px-4 py-8 md:px-8">
      <div className="mx-auto flex w-full max-w-5xl flex-col gap-8">
        <header className="flex flex-col gap-2 border-b pb-6">
          <p className="text-sm font-medium text-muted-foreground">Settings</p>
          <div className="flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
            <div>
              <h1 className="text-3xl">Workspace</h1>
            </div>
            <Button asChild variant="outline" size="sm" className="w-fit">
              <Link href="/settings/labels">
                <IconTag />
                Labels
              </Link>
            </Button>
          </div>
          {workersQuery.isLoading ? (
            <p className="text-sm text-muted-foreground">
              Loading worker status...
            </p>
          ) : workersQuery.isError ? (
            <p className="text-sm text-destructive">
              Unable to load worker status.
            </p>
          ) : null}
        </header>

        <Card>
          <CardHeader>
            <div className="flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
              <div className="flex gap-3">
                <div className="flex size-10 shrink-0 items-center justify-center rounded-md border bg-muted">
                  <BrandIcon name="github" className="size-5" />
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
                <div className="inline-flex items-center gap-1.5 rounded-md border px-2.5 py-1 text-sm text-muted-foreground">
                  <IconCheck className="size-4 text-green-600 dark:text-green-400" />
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

        <Card>
          <CardHeader>
            <CardTitle>Agent defaults</CardTitle>
            <CardDescription>
              Choose which coding agent is selected when you create a new issue.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <form
              onSubmit={submitUpdateDefaultAgent}
              className="flex flex-col gap-4 md:flex-row md:items-end md:justify-between"
            >
              <div className="grid gap-2">
                <Label htmlFor="default-agent-provider">Default agent</Label>
                <NativeSelect
                  id="default-agent-provider"
                  name="default_agent_provider"
                  defaultValue={data.defaultAgentProvider}
                  className="w-full md:w-64"
                >
                  {agentProviderOptions.map((option) => (
                    <NativeSelectOption key={option.value} value={option.value}>
                      {option.label}
                    </NativeSelectOption>
                  ))}
                </NativeSelect>
              </div>
              <div className="flex items-center gap-3">
                <div className="flex items-center gap-2 text-sm text-muted-foreground">
                  <AgentProviderIcon
                    provider={data.defaultAgentProvider}
                    className="size-4"
                  />
                  {agentProviderLabels[data.defaultAgentProvider]}
                </div>
                <Button
                  type="submit"
                  variant="outline"
                  disabled={updateDefaultAgentMutation.isPending}
                >
                  Save
                </Button>
              </div>
            </form>
          </CardContent>
        </Card>

        <ConnectedWorkersSection
          data={workersQuery.data}
          isLoading={workersQuery.isLoading}
          isError={workersQuery.isError}
          onRefresh={() =>
            queryClient.invalidateQueries({
              queryKey: queryKeys.settingsWorkers,
            })
          }
        />

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
                  <RepositoryCombobox
                    id="project-repo"
                    repositories={githubRepositories}
                    value={selectedRepo}
                    onValueChange={setSelectedRepo}
                    query={repoQuery}
                    onQueryChange={setRepoQuery}
                    disabled={
                      !isGithubConnected || githubRepositories.length === 0
                    }
                  />
                  <input type="hidden" name="repo" value={selectedRepo} />
                  {!isGithubConnected ? (
                    <div className="flex flex-col gap-2 rounded-md border border-dashed p-3 text-sm text-muted-foreground">
                      <span>Connect GitHub to choose a repository.</span>
                      {githubAppConfigured ? (
                        <Button asChild size="sm" className="w-fit">
                          <Link href="/api/integrations/github/setup">
                            <IconExternalLink />
                            Connect GitHub
                          </Link>
                        </Button>
                      ) : (
                        <Button disabled size="sm" className="w-fit">
                          <IconExternalLink />
                          Connect GitHub
                        </Button>
                      )}
                    </div>
                  ) : githubRepositoriesError ? (
                    <p className="flex items-center gap-1.5 text-sm text-destructive">
                      <IconAlertCircle className="size-4" />
                      {githubRepositoriesError}
                    </p>
                  ) : githubRepositories.length === 0 ? (
                    <p className="text-sm text-muted-foreground">
                      No repositories are available to this GitHub installation.
                    </p>
                  ) : null}
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
                  <Label htmlFor="project-auto-respond" className="font-normal">
                    Auto-respond to review feedback
                  </Label>
                </div>
                <Button
                  type="submit"
                  className="mt-2"
                  disabled={!canCreateProject}
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
                            <BrandIcon
                              name="github"
                              className="absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground"
                            />
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

function RepositoryCombobox({
  id,
  repositories,
  value,
  onValueChange,
  query,
  onQueryChange,
  disabled,
}: {
  id: string
  repositories: SettingsData["githubRepositories"]
  value: string
  onValueChange: (value: string) => void
  query: string
  onQueryChange: (value: string) => void
  disabled?: boolean
}) {
  const [isOpen, setIsOpen] = React.useState(false)
  const normalizedQuery = query.trim().toLowerCase()
  const selectedRepository = repositories.find(
    (repository) => repository.full_name === value
  )
  const filteredRepositories = React.useMemo(() => {
    if (!normalizedQuery) {
      return repositories.slice(0, 20)
    }

    return repositories
      .filter((repository) =>
        repository.full_name.toLowerCase().includes(normalizedQuery)
      )
      .slice(0, 20)
  }, [normalizedQuery, repositories])

  function chooseRepository(fullName: string) {
    onValueChange(fullName)
    onQueryChange(fullName)
    setIsOpen(false)
  }

  function updateQuery(nextQuery: string) {
    onQueryChange(nextQuery)
    setIsOpen(true)

    const exactMatch = repositories.find(
      (repository) =>
        repository.full_name.toLowerCase() === nextQuery.trim().toLowerCase()
    )
    onValueChange(exactMatch?.full_name ?? "")
  }

  return (
    <div className="relative">
      <div className="relative">
        <IconSearch className="absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" />
        <Input
          id={id}
          value={query}
          placeholder="Search repositories"
          disabled={disabled}
          role="combobox"
          aria-expanded={isOpen}
          aria-controls={`${id}-listbox`}
          aria-autocomplete="list"
          className="pr-9 pl-9"
          onChange={(event) => updateQuery(event.target.value)}
          onFocus={() => setIsOpen(true)}
          onBlur={() => window.setTimeout(() => setIsOpen(false), 100)}
        />
        <IconChevronDown className="pointer-events-none absolute top-1/2 right-3 size-4 -translate-y-1/2 text-muted-foreground" />
      </div>
      {isOpen && !disabled ? (
        <div
          id={`${id}-listbox`}
          role="listbox"
          className="absolute z-20 mt-1 max-h-64 w-full overflow-y-auto rounded-lg border bg-popover p-1 text-popover-foreground shadow-lg"
        >
          {filteredRepositories.length > 0 ? (
            filteredRepositories.map((repository) => (
              <button
                key={repository.full_name}
                type="button"
                role="option"
                aria-selected={repository.full_name === value}
                className={cn(
                  "flex w-full items-center justify-between gap-3 rounded-md px-3 py-2 text-left text-sm outline-none hover:bg-accent focus:bg-accent",
                  repository.full_name === value && "bg-accent"
                )}
                onMouseDown={(event) => event.preventDefault()}
                onClick={() => chooseRepository(repository.full_name)}
              >
                <span className="truncate">{repository.full_name}</span>
                <span className="shrink-0 text-xs text-muted-foreground">
                  {repository.private ? "Private" : "Public"}
                </span>
              </button>
            ))
          ) : (
            <div className="px-3 py-2 text-sm text-muted-foreground">
              No matching repositories
            </div>
          )}
        </div>
      ) : null}
      {selectedRepository ? (
        <p className="mt-1 text-xs text-muted-foreground">
          {selectedRepository.private ? "Private" : "Public"} repository
        </p>
      ) : null}
    </div>
  )
}
