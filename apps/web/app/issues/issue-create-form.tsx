"use client"

import Link from "next/link"
import { useRef, useState } from "react"
import {
  IconCheck,
  IconChevronDown,
  IconDeviceFloppy,
  IconFolder,
  IconSend,
} from "@tabler/icons-react"

import { runIssue, saveIssueDraft } from "@/app/issues/actions"
import type { ProjectOption } from "@/app/queries"
import { Button } from "@gentic/ui/button"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@gentic/ui/dropdown-menu"
import type { AgentProvider } from "@gentic/validators/issues"

import { MessageComposer } from "./message-composer/message-composer"

export function IssueCreateForm({
  projects,
  defaultAgentProvider = "claude_code",
  className,
}: {
  projects: ProjectOption[]
  defaultAgentProvider?: AgentProvider
  className?: string
}) {
  const [prompt, setPrompt] = useState("")
  const [files, setFiles] = useState<File[]>([])
  const [agentProvider, setAgentProvider] =
    useState<AgentProvider>(defaultAgentProvider)
  const [projectId, setProjectId] = useState("")
  const [projectError, setProjectError] = useState("")
  const projectButtonRef = useRef<HTMLButtonElement>(null)
  const projectErrorId = "issue-project-error"
  const selectedProject = projects.find((project) => project.id === projectId)
  const requireProject = () => {
    if (projectId) {
      return true
    }

    setProjectError("Select a project before running this issue.")
    projectButtonRef.current?.focus()
    return false
  }

  if (projects.length === 0) {
    return (
      <div className="mx-auto grid w-full max-w-md gap-4 rounded-3xl border border-dashed p-6 text-center">
        <p className="text-muted-foreground text-sm">
          Create a project before adding issues.
        </p>
        <Button asChild variant="outline" className="mx-auto">
          <Link href="/settings">Go to projects</Link>
        </Button>
      </div>
    )
  }

  return (
    <MessageComposer
      formId="new-issue-form"
      action={saveIssueDraft}
      className={className}
      id="issue-prompt"
      name="prompt"
      draft={prompt}
      draftFiles={files}
      onDraftChange={setPrompt}
      onFilesChange={setFiles}
      rows={3}
      placeholder="Describe what you want built, fixed, or investigated."
      required
      showCommandHint={false}
      submitAriaLabel="Run issue"
      submitDisabled={!prompt.trim()}
      agentProvider={agentProvider}
      hasMessages={false}
      onAgentProviderChange={(provider) => setAgentProvider(provider)}
      onSubmit={() => {}}
      footerStart={
        <div className="flex min-w-0 flex-col gap-1">
          <label className="sr-only" htmlFor="issue-project">
            Project
          </label>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button
                ref={projectButtonRef}
                type="button"
                aria-label="Project"
                aria-describedby={projectError ? projectErrorId : undefined}
                data-invalid={projectError ? true : undefined}
                id="issue-project"
                className="flex h-8 max-w-full min-w-0 shrink-0 items-center gap-1.5 rounded-full px-2.5 text-xs font-medium text-muted-foreground hover:bg-muted data-[invalid=true]:ring-2 data-[invalid=true]:ring-destructive/30"
              >
                <IconFolder className="size-3.5 shrink-0" />
                <span className="truncate">
                  {selectedProject
                    ? `${selectedProject.name} (${selectedProject.repo})`
                    : "Select project"}
                </span>
                <IconChevronDown className="size-3.5 shrink-0" />
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start" className="w-72">
              {projects.map((project) => (
                <DropdownMenuItem
                  key={project.id}
                  onSelect={() => {
                    setProjectId(project.id)
                    setProjectError("")
                  }}
                >
                  <IconFolder className="size-4" />
                  <span className="min-w-0 flex-1 truncate">
                    {project.name} ({project.repo})
                  </span>
                  {project.id === projectId ? (
                    <IconCheck className="ml-auto size-3.5" />
                  ) : null}
                </DropdownMenuItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>
          <input
            type="hidden"
            name="project_id"
            value={projectId}
            readOnly
          />
          {projectError ? (
            <p id={projectErrorId} className="text-xs text-destructive">
              {projectError}
            </p>
          ) : null}
        </div>
      }
      footerEnd={
        <Button
          type="submit"
          formAction={saveIssueDraft}
          variant="ghost"
          size="sm"
        >
          <IconDeviceFloppy />
          Save draft
        </Button>
      }
      submitButton={
        <Button
          type="submit"
          formAction={runIssue}
          size="icon"
          aria-label="Run issue"
          disabled={!prompt.trim()}
          className="shrink-0"
          onClick={(event) => {
            if (!requireProject()) {
              event.preventDefault()
            }
          }}
        >
          <IconSend />
        </Button>
      }
    >
      <input type="hidden" name="agent_provider" value={agentProvider} />
      <label className="sr-only" htmlFor="issue-prompt">
        Prompt
      </label>
    </MessageComposer>
  )
}
