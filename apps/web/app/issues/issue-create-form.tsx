"use client"

import Link from "next/link"
import { useEffect, useRef, useState } from "react"
import {
  IconCheck,
  IconChevronDown,
  IconDeviceFloppy,
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

const ISSUE_CREATE_DRAFT_STORAGE_KEY = "gentic:issue-create-draft:v1"

function loadStoredIssueDraft() {
  try {
    return window.localStorage.getItem(ISSUE_CREATE_DRAFT_STORAGE_KEY) ?? ""
  } catch {
    return ""
  }
}

function storeIssueDraft(prompt: string) {
  try {
    if (prompt) {
      window.localStorage.setItem(ISSUE_CREATE_DRAFT_STORAGE_KEY, prompt)
    } else {
      window.localStorage.removeItem(ISSUE_CREATE_DRAFT_STORAGE_KEY)
    }
  } catch {
    return
  }
}

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
  const [issueModel, setIssueModel] = useState<string | null>(null)
  const [projectId, setProjectId] = useState("")
  const [projectError, setProjectError] = useState("")
  const projectTriggerRef = useRef<HTMLButtonElement>(null)
  const selectedProject = projects.find((project) => project.id === projectId)
  const projectLabelId = "issue-project-label"
  const projectErrorId = "issue-project-error"
  useEffect(() => {
    const storedPrompt = loadStoredIssueDraft()

    if (!storedPrompt) {
      return
    }

    const timeoutId = window.setTimeout(() => {
      setPrompt(storedPrompt)
    }, 0)

    return () => window.clearTimeout(timeoutId)
  }, [])

  const updatePrompt = (value: string) => {
    setPrompt(value)
    storeIssueDraft(value)
  }

  const clearStoredPrompt = () => {
    storeIssueDraft("")
  }

  const requireProject = () => {
    if (projectId) {
      return true
    }

    setProjectError("Select a project before running this issue.")
    projectTriggerRef.current?.focus()
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
      onDraftChange={updatePrompt}
      onFilesChange={setFiles}
      rows={3}
      placeholder="Describe what you want built, fixed, or investigated."
      required
      showCommandHint={false}
      submitAriaLabel="Run issue"
      submitDisabled={!prompt.trim()}
      agentProvider={agentProvider}
      issueModel={issueModel}
      hasMessages={false}
      onAgentProviderChange={(provider) => {
        setAgentProvider(provider)
        setIssueModel(null)
      }}
      onIssueModelChange={(model) => setIssueModel(model)}
      onSubmit={() => {}}
      footerStart={
        <div className="flex min-w-0 flex-col gap-1">
          <label className="sr-only" id={projectLabelId}>
            Project
          </label>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button
                ref={projectTriggerRef}
                type="button"
                aria-labelledby={projectLabelId}
                aria-describedby={projectError ? projectErrorId : undefined}
                data-invalid={projectError ? true : undefined}
                className="flex h-8 max-w-full min-w-0 shrink-0 items-center gap-1.5 rounded-full px-2.5 text-xs font-medium text-muted-foreground hover:bg-muted data-invalid:ring-1 data-invalid:ring-destructive disabled:pointer-events-none disabled:opacity-50 sm:max-w-56"
              >
                <span className="truncate">
                  {selectedProject ? selectedProject.name : "Select project"}
                </span>
                <IconChevronDown className="size-3.5" />
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start" className="min-w-56">
              {projects.map((project) => (
                <DropdownMenuItem
                  key={project.id}
                  onSelect={() => {
                    setProjectId(project.id)
                    setProjectError("")
                  }}
                >
                  <span className="min-w-0 flex-1">
                    <span className="block truncate">{project.name}</span>
                    <span className="block truncate text-xs font-normal text-muted-foreground">
                      {project.repo}
                    </span>
                  </span>
                  {project.id === projectId ? (
                    <IconCheck className="ml-auto size-3.5" />
                  ) : null}
                </DropdownMenuItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>
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
          className="rounded-full px-2.5 text-xs font-medium text-muted-foreground hover:bg-muted hover:text-foreground"
          onClick={(event) => {
            if (!requireProject()) {
              event.preventDefault()
              return
            }
            clearStoredPrompt()
          }}
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
              return
            }
            clearStoredPrompt()
          }}
        >
          <IconSend />
        </Button>
      }
    >
      <input type="hidden" name="project_id" value={projectId} />
      <input type="hidden" name="agent_provider" value={agentProvider} />
      <input type="hidden" name="issue_model" value={issueModel ?? ""} />
      <label className="sr-only" htmlFor="issue-prompt">
        Prompt
      </label>
    </MessageComposer>
  )
}
