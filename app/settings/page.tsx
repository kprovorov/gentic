import type { Metadata } from "next"
import { redirect } from "next/navigation"
import {
  IconBrandGithub,
  IconKey,
  IconPlugConnected,
  IconPlus,
  IconServer,
  IconTrash,
} from "@tabler/icons-react"

import {
  createEnvironment,
  createProject,
  deleteEnvironment,
  deleteProject,
  testEnvironmentConnection,
  updateEnvironment,
  updateProject,
} from "@/app/settings/actions"
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
  environment_id: string | null
}

type Environment = {
  id: string
  name: string
  ssh_host: string | null
  ssh_port: number
  ssh_user: string | null
  public_key: string
  last_connection_status: "success" | "failed" | null
  last_connection_message: string | null
  last_tested_at: string | null
}

export const metadata: Metadata = {
  title: "Projects",
  description: "Configure the repositories Gentic can assign coding agents to.",
}

const selectClassName =
  "h-9 w-full min-w-0 rounded-3xl border border-transparent bg-input/50 px-3 py-1 text-base transition-[color,box-shadow,background-color] outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/30 disabled:pointer-events-none disabled:cursor-not-allowed disabled:opacity-50 md:text-sm"

export default async function SettingsPage() {
  const supabase = await createClient()
  const { data } = await supabase.auth.getClaims()

  if (!data?.claims) {
    redirect("/login")
  }

  const { data: projects, error } = await supabase
    .from("projects")
    .select("id,name,repo,environment_id")
    .order("created_at", { ascending: false })
    .returns<Project[]>()

  const { data: environments, error: environmentsError } = await supabase
    .from("environments")
    .select(
      "id,name,ssh_host,ssh_port,ssh_user,public_key,last_connection_status,last_connection_message,last_tested_at"
    )
    .order("created_at", { ascending: false })
    .returns<Environment[]>()

  if (error || environmentsError) {
    throw new Error(error?.message ?? environmentsError?.message)
  }

  return (
    <main className="min-h-svh bg-background px-4 py-8 md:px-8">
      <div className="mx-auto flex w-full max-w-5xl flex-col gap-8">
        <header className="flex flex-col gap-2 border-b pb-6">
          <p className="text-sm font-medium text-muted-foreground">Settings</p>
          <h1 className="text-3xl">Projects and environments</h1>
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
                <div className="grid gap-2">
                  <Label htmlFor="project-environment">Environment</Label>
                  <select
                    id="project-environment"
                    name="environment_id"
                    defaultValue=""
                    className={selectClassName}
                  >
                    <option value="">No environment</option>
                    {environments.map((environment) => (
                      <option key={environment.id} value={environment.id}>
                        {environment.name}
                      </option>
                    ))}
                  </select>
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
                      key={`${project.name}-${project.repo}-${project.environment_id ?? "none"}`}
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
                      <div className="grid gap-3 md:grid-cols-[minmax(0,1fr)_auto] md:items-end">
                        <div className="grid gap-2">
                          <Label htmlFor={`environment-${project.id}`}>
                            Environment
                          </Label>
                          <select
                            id={`environment-${project.id}`}
                            name="environment_id"
                            defaultValue={project.environment_id ?? ""}
                            className={selectClassName}
                          >
                            <option value="">No environment</option>
                            {environments.map((environment) => (
                              <option
                                key={environment.id}
                                value={environment.id}
                              >
                                {environment.name}
                              </option>
                            ))}
                          </select>
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
                      </div>
                    </form>
                  </CardContent>
                </Card>
              ))
            )}
          </div>
        </section>

        <section className="grid gap-6 border-t pt-8 lg:grid-cols-[minmax(0,360px)_1fr]">
          <Card>
            <CardHeader>
              <CardTitle>Add environment</CardTitle>
              <CardDescription>
                Create a remote SSH environment and generate its keypair.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <form action={createEnvironment} className="grid gap-4">
                <div className="grid gap-2">
                  <Label htmlFor="environment-name">Name</Label>
                  <Input
                    id="environment-name"
                    name="name"
                    placeholder="Production"
                    required
                    maxLength={120}
                  />
                </div>
                <Button type="submit" className="mt-2">
                  <IconPlus />
                  Add environment
                </Button>
              </form>
            </CardContent>
          </Card>

          <div className="flex flex-col gap-3">
            {environments.length === 0 ? (
              <div className="flex min-h-48 items-center justify-center rounded-lg border border-dashed p-8 text-center text-sm text-muted-foreground">
                No environments yet.
              </div>
            ) : (
              environments.map((environment) => (
                <Card key={environment.id}>
                  <CardContent className="grid gap-5 p-4">
                    <form
                      key={`${environment.name}-${environment.ssh_host ?? ""}-${environment.ssh_port}-${environment.ssh_user ?? ""}`}
                      action={updateEnvironment}
                      className="grid gap-4"
                    >
                      <input type="hidden" name="id" value={environment.id} />
                      <div className="grid gap-3 md:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_112px] md:items-end">
                        <div className="grid gap-2">
                          <Label htmlFor={`environment-name-${environment.id}`}>
                            Name
                          </Label>
                          <div className="relative">
                            <IconServer className="absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" />
                            <Input
                              id={`environment-name-${environment.id}`}
                              name="name"
                              defaultValue={environment.name}
                              required
                              maxLength={120}
                              className="pl-9"
                            />
                          </div>
                        </div>
                        <div className="grid gap-2">
                          <Label htmlFor={`environment-host-${environment.id}`}>
                            Host
                          </Label>
                          <Input
                            id={`environment-host-${environment.id}`}
                            name="ssh_host"
                            defaultValue={environment.ssh_host ?? ""}
                            placeholder="example.com"
                            maxLength={253}
                          />
                        </div>
                        <div className="grid gap-2">
                          <Label htmlFor={`environment-port-${environment.id}`}>
                            Port
                          </Label>
                          <Input
                            id={`environment-port-${environment.id}`}
                            name="ssh_port"
                            type="number"
                            min={1}
                            max={65535}
                            defaultValue={environment.ssh_port}
                          />
                        </div>
                      </div>

                      <div className="grid gap-3 md:grid-cols-[minmax(0,1fr)_auto] md:items-end">
                        <div className="grid gap-2">
                          <Label htmlFor={`environment-user-${environment.id}`}>
                            SSH user
                          </Label>
                          <Input
                            id={`environment-user-${environment.id}`}
                            name="ssh_user"
                            defaultValue={environment.ssh_user ?? ""}
                            placeholder="deploy"
                            maxLength={64}
                          />
                        </div>
                        <div className="flex gap-2">
                          <Button type="submit" variant="outline">
                            Save
                          </Button>
                          <Button
                            formAction={testEnvironmentConnection}
                            variant="secondary"
                          >
                            <IconPlugConnected />
                            Test
                          </Button>
                          <Button
                            formAction={deleteEnvironment}
                            variant="destructive"
                            size="icon"
                            aria-label={`Delete ${environment.name}`}
                          >
                            <IconTrash />
                          </Button>
                        </div>
                      </div>
                    </form>

                    <div className="grid gap-2">
                      <Label htmlFor={`environment-key-${environment.id}`}>
                        Public key
                      </Label>
                      <div className="relative">
                        <IconKey className="absolute top-3 left-3 size-4 text-muted-foreground" />
                        <textarea
                          id={`environment-key-${environment.id}`}
                          readOnly
                          value={environment.public_key}
                          className="min-h-24 w-full resize-y rounded-3xl border border-transparent bg-input/50 px-3 py-2 pl-9 font-mono text-xs break-all text-foreground outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/30"
                        />
                      </div>
                    </div>

                    {environment.last_connection_status ? (
                      <div
                        className={
                          environment.last_connection_status === "success"
                            ? "rounded-lg bg-emerald-500/10 px-3 py-2 text-sm text-emerald-700 dark:text-emerald-300"
                            : "rounded-lg bg-destructive/10 px-3 py-2 text-sm text-destructive"
                        }
                      >
                        {environment.last_connection_message}
                        {environment.last_tested_at ? (
                          <span className="ml-2 text-muted-foreground">
                            {new Intl.DateTimeFormat("en", {
                              dateStyle: "medium",
                              timeStyle: "short",
                            }).format(new Date(environment.last_tested_at))}
                          </span>
                        ) : null}
                      </div>
                    ) : null}
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
