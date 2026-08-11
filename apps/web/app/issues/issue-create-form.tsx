"use client"

import Link from "next/link"
import { useRouter } from "next/navigation"
import type React from "react"
import { useEffect, useRef, useState } from "react"
import { useQuery } from "@tanstack/react-query"
import {
  IconCheck,
  IconChevronDown,
  IconDeviceFloppy,
  IconDots,
  IconLoader2,
  IconSend,
  IconTagFilled,
  IconX,
} from "@tabler/icons-react"

import { fetchSettingsLabelsData } from "@/app/client-queries"
import {
  abandonIssueCreation,
  finishIssueCreation,
  startIssueCreation,
} from "@/app/issues/actions"
import type { ProjectOption } from "@/app/queries"
import { queryKeys, queryStaleTimes } from "@/app/query-keys"
import { BrandIcon } from "@/components/agent-provider-icon"
import { useSupabaseClient } from "@gentic/supabase/client"
import { Button } from "@gentic/ui/button"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@gentic/ui/dropdown-menu"
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
import {
  appendAttachmentDescriptors,
  appendAttachmentIds,
  uploadAttachmentFiles,
} from "./attachment-uploads"
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

// Filled, neutral pill styling shared by the interactive controls in the
// composer's meta row (model, priority, and the overflow menu). The selected
// label chips reuse the same fill without the hover state, since only their
// remove button is clickable.
const metaPillClassName = "bg-muted/60 text-foreground hover:bg-muted"

export function IssueCreateForm({
  projects,
  defaultAgentProvider = "claude_code",
  fillHeight = false,
  className,
}: {
  projects: ProjectOption[]
  defaultAgentProvider?: AgentProvider
  // Stretch the body field to consume the container's height instead of sizing
  // to its content. Used by the New Issue dialog's expanded state.
  fillHeight?: boolean
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
  const [submitError, setSubmitError] = useState("")
  const [pendingAction, setPendingAction] = useState<PendingAction>(null)
  const projectTriggerRef = useRef<HTMLButtonElement>(null)
  // Which submit button was pressed. Both are `type="submit"` so the browser
  // still enforces the textarea's `required` before `handleSubmit` runs, which
  // leaves no room for the action to be an argument.
  const intentRef = useRef<PendingAction>("draft")
  const router = useRouter()
  const supabase = useSupabaseClient()
  // Shares the picker's query key, so the chips resolve from the same cache
  // entry the overflow menu already fetches.
  const labelsQuery = useQuery({
    queryKey: queryKeys.settingsLabels(""),
    queryFn: () => fetchSettingsLabelsData(),
    staleTime: queryStaleTimes.formOptions,
  })
  const labelsById = new Map(
    (labelsQuery.data?.labels ?? []).map((label) => [label.id, label])
  )
  const selectedLabels = labelIds
    .map((id) => labelsById.get(id))
    .filter((label) => label !== undefined)
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

  const handleActionClick = (
    event: React.MouseEvent<HTMLButtonElement>,
    action: Exclude<PendingAction, null>
  ) => {
    intentRef.current = action

    if (!requireProject()) {
      event.preventDefault()
    }
  }

  // Attachments are uploaded from here rather than posted with the form: a
  // Server Action body is capped well below the 25MB a single attachment may
  // be, so the actions only exchange metadata and signed upload tickets while
  // the bytes go straight to Storage.
  const handleSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault()

    if (pendingAction || !requireProject()) {
      return
    }

    const action = intentRef.current
    const status = action === "run" ? "todo" : "draft"
    setPendingAction(action)
    setSubmitError("")

    const start = new FormData(event.currentTarget)
    appendAttachmentDescriptors(start, files)

    try {
      const { issueId, href, uploads } = await startIssueCreation(start)

      try {
        const attachmentIds = await uploadAttachmentFiles(
          supabase,
          uploads,
          files
        )
        const finish = new FormData()
        finish.set("issue_id", issueId)
        finish.set("status", status)
        appendAttachmentIds(finish, attachmentIds)
        await finishIssueCreation(finish)
      } catch (error) {
        const abandon = new FormData()
        abandon.set("issue_id", issueId)
        await abandonIssueCreation(abandon).catch(() => {})
        throw error
      }

      clearStoredDraft()
      router.push(href)
    } catch (error) {
      setPendingAction(null)
      setSubmitError(getCreateErrorMessage(error))
    }
  }

  return (
    <form
      id="new-issue-form"
      onSubmit={handleSubmit}
      className={cn(
        "flex min-w-0 flex-col gap-3",
        fillHeight && "min-h-0 flex-1",
        className
      )}
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
            <button
              ref={projectTriggerRef}
              type="button"
              aria-labelledby={projectLabelId}
              aria-describedby={projectError ? projectErrorId : undefined}
              data-invalid={projectError ? true : undefined}
              className="flex h-8 max-w-full min-w-0 shrink-0 items-center gap-1.5 self-start rounded-full border border-border bg-background px-2.5 text-xs font-medium text-foreground hover:bg-muted data-invalid:border-destructive data-invalid:ring-1 data-invalid:ring-destructive"
            >
              <BrandIcon name="github" className="size-3.5 shrink-0" />
              <span className="truncate">
                {selectedProject ? selectedProject.repo : "Select repository"}
              </span>
              <IconChevronDown className="size-3.5 shrink-0 opacity-70" />
            </button>
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
        className={cn(fillHeight && "flex min-h-0 flex-1 flex-col")}
        textareaClassName={cn(
          "resize-none",
          fillHeight ? "min-h-0 flex-1" : "min-h-20"
        )}
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
              className={metaPillClassName}
            />

            <label className="sr-only" id={priorityLabelId}>
              Priority
            </label>
            <DropdownMenu modal={false}>
              <DropdownMenuTrigger asChild>
                <button
                  type="button"
                  aria-labelledby={priorityLabelId}
                  className={cn(
                    "flex h-8 shrink-0 items-center gap-1.5 rounded-full px-2.5 text-xs font-medium",
                    metaPillClassName
                  )}
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

            <Popover>
              <PopoverTrigger asChild>
                <button
                  type="button"
                  aria-label="More options"
                  className={cn(
                    "flex size-8 shrink-0 items-center justify-center rounded-full text-muted-foreground",
                    metaPillClassName
                  )}
                >
                  <IconDots className="size-4" />
                </button>
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

            {selectedLabels.map((label) => (
              <span
                key={label.id}
                className="flex h-8 max-w-full min-w-0 items-center gap-1.5 rounded-full bg-muted/60 pr-1 pl-2.5 text-xs font-medium text-foreground"
              >
                <IconTagFilled
                  aria-hidden
                  className="size-3.5 shrink-0"
                  style={{ color: label.color }}
                />
                <span className="min-w-0 truncate">{label.name}</span>
                <button
                  type="button"
                  aria-label={`Remove ${label.name} label`}
                  onClick={() =>
                    setLabelIds(labelIds.filter((id) => id !== label.id))
                  }
                  className="flex size-5 shrink-0 items-center justify-center rounded-full text-muted-foreground hover:bg-foreground/10 hover:text-foreground"
                >
                  <IconX className="size-3.5" />
                </button>
              </span>
            ))}
          </>
        }
        footerEnd={
          <div className="ml-auto flex items-center gap-1">
            <SaveDraftButton
              pendingAction={pendingAction}
              onClick={(event) => handleActionClick(event, "draft")}
            />
            <RunIssueButton
              disabled={!body.trim()}
              pendingAction={pendingAction}
              onClick={(event) => handleActionClick(event, "run")}
            />
          </div>
        }
      />

      {submitError ? (
        <p role="alert" className="text-xs text-destructive">
          {submitError}
        </p>
      ) : null}
    </form>
  )
}

function getCreateErrorMessage(error: unknown) {
  if (error instanceof Error && error.message) {
    return error.message
  }
  return "Could not create this issue. Please try again."
}

type PendingAction = "draft" | "run" | null

function SaveDraftButton({
  onClick,
  pendingAction,
}: {
  onClick: (event: React.MouseEvent<HTMLButtonElement>) => void
  pendingAction: PendingAction
}) {
  return (
    <Button
      type="submit"
      variant="ghost"
      size="sm"
      disabled={pendingAction !== null}
      className="text-muted-foreground hover:text-foreground"
      onClick={onClick}
    >
      Save Draft
      {pendingAction === "draft" ? (
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
}: {
  disabled: boolean
  onClick: (event: React.MouseEvent<HTMLButtonElement>) => void
  pendingAction: PendingAction
}) {
  return (
    <Button
      type="submit"
      size="sm"
      disabled={disabled || pendingAction !== null}
      className="shrink-0 px-3.5"
      onClick={onClick}
    >
      Run Agent
      {pendingAction === "run" ? (
        <IconLoader2 className="animate-spin" />
      ) : (
        <IconSend />
      )}
    </Button>
  )
}
