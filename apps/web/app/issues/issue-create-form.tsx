"use client"

import Link from "next/link"
import type React from "react"
import { useEffect, useRef, useState } from "react"
import { useFormStatus } from "react-dom"
import {
  IconCheck,
  IconChevronDown,
  IconDeviceFloppy,
  IconLoader2,
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
import {
  agentProviderSchema,
  defaultIssuePriority,
  issueModelSchema,
  issuePrioritySchema,
  type AgentProvider,
  type IssuePriority,
} from "@gentic/validators/issues"

import { AutomaticPrPreferenceField } from "./automatic-pr-preference-field"
import { IssueLabelsField } from "./issue-labels-field"
import {
  issuePriorityIcons,
  issuePriorityLabels,
  issuePriorityOptions,
} from "./issue-priority-meta"
import { MessageComposer } from "./message-composer/message-composer"

const ISSUE_CREATE_DRAFT_STORAGE_KEY = "gentic:issue-create-draft:v1"

function loadStoredIssueDraft() {
  try {
    return window.localStorage.getItem(ISSUE_CREATE_DRAFT_STORAGE_KEY) ?? ""
  } catch {
    return ""
  }
}

function storeIssueDraft(body: string) {
  try {
    if (body) {
      window.localStorage.setItem(ISSUE_CREATE_DRAFT_STORAGE_KEY, body)
    } else {
      window.localStorage.removeItem(ISSUE_CREATE_DRAFT_STORAGE_KEY)
    }
  } catch {
    return
  }
}

const ISSUE_CREATE_SETTINGS_STORAGE_KEY = "gentic:issue-create-settings:v1"

type IssueCreateSettings = {
  projectId?: string
  priority?: IssuePriority
  agentProvider?: AgentProvider
  issueModel?: string | null
  createPrAutomatically?: boolean
}

function loadStoredIssueSettings(): IssueCreateSettings {
  try {
    const raw = window.localStorage.getItem(ISSUE_CREATE_SETTINGS_STORAGE_KEY)

    if (!raw) {
      return {}
    }

    const parsed: unknown = JSON.parse(raw)

    if (typeof parsed !== "object" || parsed === null) {
      return {}
    }

    const candidate = parsed as Record<string, unknown>
    const settings: IssueCreateSettings = {}

    if (typeof candidate.projectId === "string") {
      settings.projectId = candidate.projectId
    }

    const priority = issuePrioritySchema.safeParse(candidate.priority)
    if (priority.success) {
      settings.priority = priority.data
    }

    const agentProvider = agentProviderSchema.safeParse(
      candidate.agentProvider
    )
    if (agentProvider.success) {
      settings.agentProvider = agentProvider.data
    }

    const issueModel = issueModelSchema.safeParse(candidate.issueModel ?? null)
    if (issueModel.success) {
      settings.issueModel = issueModel.data
    }

    if (typeof candidate.createPrAutomatically === "boolean") {
      settings.createPrAutomatically = candidate.createPrAutomatically
    }

    return settings
  } catch {
    return {}
  }
}

function storeIssueSettings(settings: IssueCreateSettings) {
  try {
    window.localStorage.setItem(
      ISSUE_CREATE_SETTINGS_STORAGE_KEY,
      JSON.stringify(settings)
    )
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
  const [body, setBody] = useState("")
  const [files, setFiles] = useState<File[]>([])
  const [agentProvider, setAgentProvider] =
    useState<AgentProvider>(defaultAgentProvider)
  const [issueModel, setIssueModel] = useState<string | null>(null)
  const [priority, setPriority] = useState<IssuePriority>(defaultIssuePriority)
  const [projectId, setProjectId] = useState("")
  const [labelIds, setLabelIds] = useState<string[]>([])
  const [createPrAutomatically, setCreatePrAutomatically] = useState(true)
  const [prSettingsVersion, setPrSettingsVersion] = useState(0)
  const [projectError, setProjectError] = useState("")
  const projectTriggerRef = useRef<HTMLButtonElement>(null)
  const selectedProject = projects.find((project) => project.id === projectId)
  const PriorityIcon = issuePriorityIcons[priority]
  const projectLabelId = "issue-project-label"
  const projectErrorId = "issue-project-error"
  const priorityLabelId = "issue-priority-label"
  useEffect(() => {
    const storedBody = loadStoredIssueDraft()

    if (!storedBody) {
      return
    }

    const timeoutId = window.setTimeout(() => {
      setBody(storedBody)
    }, 0)

    return () => window.clearTimeout(timeoutId)
  }, [])

  useEffect(() => {
    const storedSettings = loadStoredIssueSettings()

    if (Object.keys(storedSettings).length === 0) {
      return
    }

    const timeoutId = window.setTimeout(() => {
      if (storedSettings.agentProvider) {
        setAgentProvider(storedSettings.agentProvider)
      }
      if (storedSettings.issueModel !== undefined) {
        setIssueModel(storedSettings.issueModel)
      }
      if (storedSettings.priority) {
        setPriority(storedSettings.priority)
      }
      if (
        storedSettings.projectId &&
        projects.some((project) => project.id === storedSettings.projectId)
      ) {
        setProjectId(storedSettings.projectId)
      }
      if (storedSettings.createPrAutomatically !== undefined) {
        setCreatePrAutomatically(storedSettings.createPrAutomatically)
        setPrSettingsVersion((version) => version + 1)
      }
    }, 0)

    return () => window.clearTimeout(timeoutId)
  }, [projects])

  const persistSettings = (overrides: Partial<IssueCreateSettings>) => {
    storeIssueSettings({
      projectId,
      priority,
      agentProvider,
      issueModel,
      createPrAutomatically,
      ...overrides,
    })
  }

  const updateBody = (value: string) => {
    setBody(value)
    storeIssueDraft(value)
  }

  const clearStoredBody = () => {
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
        <p className="text-sm text-muted-foreground">
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
      id="issue-body"
      name="body"
      draft={body}
      draftFiles={files}
      onDraftChange={updateBody}
      onFilesChange={setFiles}
      rows={3}
      placeholder="Describe what you want built, fixed, or investigated."
      required
      submitAriaLabel="Run issue"
      submitDisabled={!body.trim()}
      agentProvider={agentProvider}
      issueModel={issueModel}
      hasMessages={false}
      onAgentModelChange={(provider, model) => {
        setAgentProvider(provider)
        setIssueModel(model)
        persistSettings({ agentProvider: provider, issueModel: model })
      }}
      onSubmit={() => {}}
      footerStart={
        <div className="flex min-w-0 flex-wrap items-start gap-2">
          <div className="flex min-w-0 flex-col gap-1">
            <label className="sr-only" id={projectLabelId}>
              Project
            </label>
            {/* Non-modal: nested in the New Issue Dialog, whose default-modal
                DropdownMenu would disable pointer events on the trigger
                while open, so re-clicking it to close falls through to the
                Dialog's overlay and closes the whole dialog instead. */}
            <DropdownMenu modal={false}>
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
                      persistSettings({ projectId: project.id })
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

          <label className="sr-only" id={priorityLabelId}>
            Priority
          </label>
          <DropdownMenu modal={false}>
            <DropdownMenuTrigger asChild>
              <button
                type="button"
                aria-labelledby={priorityLabelId}
                className="flex h-8 shrink-0 items-center gap-1.5 rounded-full px-2.5 text-xs font-medium text-muted-foreground hover:bg-muted"
              >
                <PriorityIcon className="size-3.5" />
                <span>{issuePriorityLabels[priority]}</span>
                <IconChevronDown className="size-3.5 opacity-70" />
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start" className="w-48">
              {issuePriorityOptions.map((option) => {
                const OptionIcon = issuePriorityIcons[option.value]
                const isSelected = option.value === priority

                return (
                  <DropdownMenuItem
                    key={option.value}
                    onSelect={() => {
                      setPriority(option.value)
                      persistSettings({ priority: option.value })
                    }}
                    className="gap-3"
                  >
                    <OptionIcon className="size-4" />
                    <span className="min-w-0 flex-1 truncate">
                      {option.label}
                    </span>
                    {isSelected ? <IconCheck className="size-4" /> : null}
                  </DropdownMenuItem>
                )
              })}
            </DropdownMenuContent>
          </DropdownMenu>

          <IssueLabelsField
            selectedIds={labelIds}
            onSelectedIdsChange={setLabelIds}
          />
        </div>
      }
      belowField={
        <AutomaticPrPreferenceField
          key={prSettingsVersion}
          defaultChecked={createPrAutomatically}
          onCheckedChange={(checked) => {
            setCreatePrAutomatically(checked)
            persistSettings({ createPrAutomatically: checked })
          }}
        />
      }
      footerEnd={
        <SaveDraftButton
          onClick={(event) => {
            if (!requireProject()) {
              event.preventDefault()
              return
            }
            clearStoredBody()
          }}
        />
      }
      submitButton={
        <RunIssueButton
          disabled={!body.trim()}
          onClick={(event) => {
            if (!requireProject()) {
              event.preventDefault()
              return
            }
            clearStoredBody()
          }}
        />
      }
    >
      <input type="hidden" name="project_id" value={projectId} />
      <input type="hidden" name="priority" value={priority} />
      <input type="hidden" name="agent_provider" value={agentProvider} />
      <input type="hidden" name="issue_model" value={issueModel ?? ""} />
      {labelIds.map((id) => (
        <input key={id} type="hidden" name="label_id" value={id} />
      ))}
      <label className="sr-only" htmlFor="issue-body">
        Body
      </label>
    </MessageComposer>
  )
}

function SaveDraftButton({
  onClick,
}: {
  onClick: (event: React.MouseEvent<HTMLButtonElement>) => void
}) {
  const { pending } = useFormStatus()

  return (
    <Button
      type="submit"
      formAction={saveIssueDraft}
      variant="ghost"
      size="sm"
      disabled={pending}
      className="rounded-full px-2.5 text-xs font-medium text-muted-foreground hover:bg-muted hover:text-foreground"
      onClick={onClick}
    >
      {pending ? (
        <IconLoader2 className="animate-spin" />
      ) : (
        <IconDeviceFloppy />
      )}
      Save draft
    </Button>
  )
}

function RunIssueButton({
  disabled,
  onClick,
}: {
  disabled: boolean
  onClick: (event: React.MouseEvent<HTMLButtonElement>) => void
}) {
  const { pending } = useFormStatus()

  return (
    <Button
      type="submit"
      formAction={runIssue}
      size="icon"
      aria-label="Run issue"
      disabled={disabled || pending}
      className="shrink-0"
      onClick={onClick}
    >
      {pending ? <IconLoader2 className="animate-spin" /> : <IconSend />}
    </Button>
  )
}
