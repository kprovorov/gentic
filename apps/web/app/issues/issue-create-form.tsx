"use client"

import Link from "next/link"
import type React from "react"
import { useEffect, useRef, useState } from "react"
import { useFormStatus } from "react-dom"
import {
  IconCheck,
  IconChevronDown,
  IconDeviceFloppy,
  IconDots,
  IconLoader2,
  IconSend,
} from "@tabler/icons-react"

import { runIssue, saveIssueDraft } from "@/app/issues/actions"
import type { ProjectOption } from "@/app/queries"
import { BrandIcon } from "@/components/agent-provider-icon"
import { Button } from "@gentic/ui/button"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@gentic/ui/dropdown-menu"
import { PillButton, PillLabel } from "@gentic/ui/pill"
import { Popover, PopoverContent, PopoverTrigger } from "@gentic/ui/popover"
import { cn } from "@gentic/ui/utils"
import {
  agentProviderSchema,
  defaultIssuePriority,
  issueModelSchema,
  issuePrioritySchema,
  type AgentProvider,
  type IssuePriority,
} from "@gentic/validators/issues"

import { AttachmentPromptField } from "./attachment-prompt-field"
import { AutomaticPrPreferenceField } from "./automatic-pr-preference-field"
import { IssueLabelsPicker } from "./issue-labels-field"
import {
  issuePriorityIcons,
  issuePriorityLabels,
  issuePriorityOptions,
} from "./issue-priority-meta"
import { AgentModelPicker } from "./message-composer/agent-model-picker"

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

const ISSUE_CREATE_FILES_DB_NAME = "gentic-issue-draft"
const ISSUE_CREATE_FILES_STORE_NAME = "files"
const ISSUE_CREATE_FILES_KEY = "issue-create-draft-files:v1"

type StoredIssueDraftFile = {
  name: string
  type: string
  lastModified: number
  buffer: ArrayBuffer
}

function openIssueDraftFilesDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = window.indexedDB.open(ISSUE_CREATE_FILES_DB_NAME, 1)
    request.onupgradeneeded = () => {
      request.result.createObjectStore(ISSUE_CREATE_FILES_STORE_NAME)
    }
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error)
  })
}

async function loadStoredIssueDraftFiles(): Promise<File[]> {
  if (typeof window === "undefined" || !window.indexedDB) {
    return []
  }

  try {
    const db = await openIssueDraftFilesDb()
    const stored = await new Promise<StoredIssueDraftFile[]>(
      (resolve, reject) => {
        const request = db
          .transaction(ISSUE_CREATE_FILES_STORE_NAME, "readonly")
          .objectStore(ISSUE_CREATE_FILES_STORE_NAME)
          .get(ISSUE_CREATE_FILES_KEY)
        request.onsuccess = () =>
          resolve((request.result as StoredIssueDraftFile[] | undefined) ?? [])
        request.onerror = () => reject(request.error)
      }
    )
    db.close()
    return stored.map(
      (file) =>
        new File([file.buffer], file.name, {
          type: file.type,
          lastModified: file.lastModified,
        })
    )
  } catch {
    return []
  }
}

async function storeIssueDraftFiles(files: File[]) {
  if (typeof window === "undefined" || !window.indexedDB) {
    return
  }

  try {
    const stored: StoredIssueDraftFile[] = await Promise.all(
      files.map(async (file) => ({
        name: file.name,
        type: file.type,
        lastModified: file.lastModified,
        buffer: await file.arrayBuffer(),
      }))
    )
    const db = await openIssueDraftFilesDb()
    await new Promise<void>((resolve, reject) => {
      const store = db
        .transaction(ISSUE_CREATE_FILES_STORE_NAME, "readwrite")
        .objectStore(ISSUE_CREATE_FILES_STORE_NAME)
      const request =
        stored.length > 0
          ? store.put(stored, ISSUE_CREATE_FILES_KEY)
          : store.delete(ISSUE_CREATE_FILES_KEY)
      request.onsuccess = () => resolve()
      request.onerror = () => reject(request.error)
    })
    db.close()
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

    const agentProvider = agentProviderSchema.safeParse(candidate.agentProvider)
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
  const [pendingAction, setPendingAction] = useState<"draft" | "run" | null>(
    null
  )
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
    let cancelled = false

    loadStoredIssueDraftFiles().then((storedFiles) => {
      if (!cancelled && storedFiles.length > 0) {
        setFiles(storedFiles)
      }
    })

    return () => {
      cancelled = true
    }
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

  const updateFiles = (value: File[]) => {
    setFiles(value)
    void storeIssueDraftFiles(value)
  }

  const clearStoredDraft = () => {
    storeIssueDraft("")
    void storeIssueDraftFiles([])
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

  const handleActionClick = (event: React.MouseEvent<HTMLButtonElement>) => {
    if (!requireProject()) {
      event.preventDefault()
      return
    }
    clearStoredDraft()
  }

  return (
    <form
      id="new-issue-form"
      action={saveIssueDraft}
      className={cn("flex min-w-0 flex-col gap-3", className)}
    >
      <input type="hidden" name="project_id" value={projectId} />
      <input type="hidden" name="priority" value={priority} />
      <input type="hidden" name="agent_provider" value={agentProvider} />
      <input type="hidden" name="issue_model" value={issueModel ?? ""} />
      <input
        type="hidden"
        name="create_pr_automatically"
        value={createPrAutomatically ? "true" : "false"}
      />
      {labelIds.map((id) => (
        <input key={id} type="hidden" name="label_id" value={id} />
      ))}
      <label className="sr-only" htmlFor="issue-body">
        Body
      </label>

      {/* Header row: repository selector. The expand/close window controls
          are supplied by the dialog chrome wrapping this form, so pad the
          right edge to leave room for them. */}
      <div className="flex min-w-0 flex-col gap-1 pr-14">
        <label className="sr-only" id={projectLabelId}>
          Project
        </label>
        {/* Non-modal: nested in the New Issue Dialog, whose default-modal
            DropdownMenu would disable pointer events on the trigger while
            open, so re-clicking it to close falls through to the Dialog's
            overlay and closes the whole dialog instead. */}
        <DropdownMenu modal={false}>
          <DropdownMenuTrigger asChild>
            <PillButton
              ref={projectTriggerRef}
              variant="outline"
              size="sm"
              aria-labelledby={projectLabelId}
              aria-describedby={projectError ? projectErrorId : undefined}
              aria-invalid={projectError ? true : undefined}
              className="self-start"
            >
              <BrandIcon name="github" />
              <PillLabel>
                {selectedProject ? selectedProject.repo : "Select repository"}
              </PillLabel>
              <IconChevronDown className="opacity-70" />
            </PillButton>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start" className="min-w-64">
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

      <AttachmentPromptField
        variant="bare"
        id="issue-body"
        name="body"
        value={body}
        onChange={updateBody}
        files={files}
        onFilesChange={updateFiles}
        rows={3}
        placeholder="Describe your task…"
        required
        textareaClassName="min-h-20 resize-none"
        metaRow={
          <>
            <AgentModelPicker
              agentProvider={agentProvider}
              issueModel={issueModel}
              hasMessages={false}
              onAgentModelChange={(provider, model) => {
                setAgentProvider(provider)
                setIssueModel(model)
                persistSettings({ agentProvider: provider, issueModel: model })
              }}
            />

            <label className="sr-only" id={priorityLabelId}>
              Priority
            </label>
            <DropdownMenu modal={false}>
              <DropdownMenuTrigger asChild>
                <PillButton size="sm" aria-labelledby={priorityLabelId}>
                  <PriorityIcon />
                  <PillLabel>{issuePriorityLabels[priority]}</PillLabel>
                  <IconChevronDown className="opacity-70" />
                </PillButton>
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

            <Popover>
              <PopoverTrigger asChild>
                <PillButton
                  size="sm"
                  aria-label="More options"
                  className="min-w-8 px-2"
                >
                  {labelIds.length > 0 ? (
                    <span className="tabular-nums">{labelIds.length}</span>
                  ) : null}
                  <IconDots className="size-4" />
                </PillButton>
              </PopoverTrigger>
              <PopoverContent align="start" className="w-72 p-0">
                <IssueLabelsPicker
                  selectedIds={labelIds}
                  onSelectedIdsChange={setLabelIds}
                />
                <div className="border-t border-foreground/10 p-3">
                  <AutomaticPrPreferenceField
                    key={prSettingsVersion}
                    defaultChecked={createPrAutomatically}
                    renderHiddenInput={false}
                    onCheckedChange={(checked) => {
                      setCreatePrAutomatically(checked)
                      persistSettings({ createPrAutomatically: checked })
                    }}
                  />
                </div>
              </PopoverContent>
            </Popover>
          </>
        }
        footerEnd={
          <div className="ml-auto flex items-center gap-1">
            <SaveDraftButton
              pendingAction={pendingAction}
              onPendingActionChange={setPendingAction}
              onClick={handleActionClick}
            />
            <RunIssueButton
              disabled={!body.trim()}
              pendingAction={pendingAction}
              onPendingActionChange={setPendingAction}
              onClick={handleActionClick}
            />
          </div>
        }
      />
    </form>
  )
}

type PendingAction = "draft" | "run" | null

function SaveDraftButton({
  onClick,
  pendingAction,
  onPendingActionChange,
}: {
  onClick: (event: React.MouseEvent<HTMLButtonElement>) => void
  pendingAction: PendingAction
  onPendingActionChange: (action: PendingAction) => void
}) {
  const { pending } = useFormStatus()

  useEffect(() => {
    if (!pending) {
      onPendingActionChange(null)
    }
  }, [pending, onPendingActionChange])

  return (
    <Button
      type="submit"
      formAction={saveIssueDraft}
      variant="ghost"
      size="sm"
      disabled={pending}
      className="text-muted-foreground hover:text-foreground"
      onClick={(event) => {
        onClick(event)
        if (!event.defaultPrevented) {
          onPendingActionChange("draft")
        }
      }}
    >
      Save Draft
      {pending && pendingAction === "draft" ? (
        <IconLoader2 className="animate-spin" />
      ) : (
        <IconDeviceFloppy />
      )}
    </Button>
  )
}

function RunIssueButton({
  disabled,
  onClick,
  pendingAction,
  onPendingActionChange,
}: {
  disabled: boolean
  onClick: (event: React.MouseEvent<HTMLButtonElement>) => void
  pendingAction: PendingAction
  onPendingActionChange: (action: PendingAction) => void
}) {
  const { pending } = useFormStatus()

  useEffect(() => {
    if (!pending) {
      onPendingActionChange(null)
    }
  }, [pending, onPendingActionChange])

  return (
    <Button
      type="submit"
      formAction={runIssue}
      size="sm"
      disabled={disabled || pending}
      className="shrink-0 px-3.5"
      onClick={(event) => {
        onClick(event)
        if (!event.defaultPrevented) {
          onPendingActionChange("run")
        }
      }}
    >
      Run Agent
      {pending && pendingAction === "run" ? (
        <IconLoader2 className="animate-spin" />
      ) : (
        <IconSend />
      )}
    </Button>
  )
}
