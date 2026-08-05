"use client"

import * as React from "react"
import {
  IconAlertTriangle,
  IconBan,
  IconCheck,
  IconClock,
  IconCopy,
  IconDotsVertical,
  IconPencil,
  IconPlayerPlay,
  IconPlugConnected,
  IconRefresh,
  IconServer,
  IconTrash,
} from "@tabler/icons-react"

import type { SettingsWorker, SettingsWorkersData } from "@/app/queries"
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@gentic/ui/alert-dialog"
import { Button } from "@gentic/ui/button"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@gentic/ui/card"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@gentic/ui/dropdown-menu"
import { Input } from "@gentic/ui/input"
import { Label } from "@gentic/ui/label"

type EnrollmentCode = {
  code: string
  expires_at: string
}

type MutationState =
  | { status: "idle"; message?: undefined }
  | { status: "pending"; message?: undefined }
  | { status: "error"; message: string }

type ConnectedWorkersSectionProps = {
  data: SettingsWorkersData | undefined
  isLoading: boolean
  isError: boolean
  onRefresh: () => Promise<unknown> | unknown
}

const primaryStateLabels: Record<SettingsWorker["primaryState"], string> = {
  "setup-incomplete": "Setup incomplete",
  online: "Online",
  offline: "Offline",
  banned: "Banned",
}

const versionHealthLabels: Record<
  SettingsWorker["genticVersionHealth"],
  string
> = {
  current: "Current",
  "update-available": "Update available",
  unsupported: "Unsupported",
}

export function ConnectedWorkersSection({
  data,
  isLoading,
  isError,
  onRefresh,
}: ConnectedWorkersSectionProps) {
  const [connectOpen, setConnectOpen] = React.useState(false)
  const [enrollmentCode, setEnrollmentCode] =
    React.useState<EnrollmentCode | null>(null)
  const [connectState, setConnectState] = React.useState<MutationState>({
    status: "idle",
  })
  const [hiddenDeletedWorkerIds, setHiddenDeletedWorkerIds] = React.useState(
    () => new Set<string>(),
  )
  const workers =
    data?.workers.filter((worker) => !hiddenDeletedWorkerIds.has(worker.id)) ??
    []
  const summary = data?.summary ?? { online: 0, offline: 0, banned: 0 }
  const setupIncomplete = workers.filter(
    (worker) => worker.primaryState === "setup-incomplete",
  ).length

  async function generateEnrollmentCode() {
    setConnectState({ status: "pending" })
    try {
      const nextCode = await postJson<EnrollmentCode>(
        "/api/app/workers/enrollment-code",
      )
      setEnrollmentCode(nextCode)
      setConnectState({ status: "idle" })
    } catch (error) {
      setConnectState({
        status: "error",
        message: errorMessage(error, "Unable to generate a worker code."),
      })
    }
  }

  function openConnectDialog() {
    setConnectOpen(true)
    void generateEnrollmentCode()
  }

  return (
    <Card>
      <CardHeader>
        <div className="flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
          <div className="grid gap-1">
            <CardTitle>Connected workers</CardTitle>
            <CardDescription>
              Manage local worker processes that can claim and run tasks.
            </CardDescription>
          </div>
          <Button type="button" onClick={openConnectDialog}>
            <IconPlugConnected />
            Connect worker
          </Button>
        </div>
      </CardHeader>
      <CardContent className="grid gap-4">
        <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
          <SummaryCount label="Online" value={summary.online} />
          <SummaryCount label="Offline" value={summary.offline} />
          <SummaryCount label="Banned" value={summary.banned} />
          <SummaryCount label="Setup incomplete" value={setupIncomplete} />
        </div>

        {isLoading ? (
          <div className="rounded-md border border-dashed p-4 text-sm text-muted-foreground">
            Loading workers...
          </div>
        ) : isError ? (
          <div className="flex items-center gap-2 rounded-md border border-destructive/30 bg-destructive/5 p-4 text-sm text-destructive">
            <IconAlertTriangle className="size-4" />
            Unable to load connected workers.
          </div>
        ) : workers.length === 0 ? (
          <div className="rounded-md border border-dashed p-4 text-sm text-muted-foreground">
            No connected workers yet.
          </div>
        ) : (
          <div className="grid gap-3">
            {workers.map((worker) => (
              <WorkerRow
                key={worker.id}
                worker={worker}
                allWorkers={workers}
                onRefresh={onRefresh}
                onDeleted={(workerId) =>
                  setHiddenDeletedWorkerIds((current) => {
                    const next = new Set(current)
                    next.add(workerId)
                    return next
                  })
                }
              />
            ))}
          </div>
        )}
      </CardContent>

      <ConnectionDialog
        open={connectOpen}
        onOpenChange={setConnectOpen}
        enrollmentCode={enrollmentCode}
        state={connectState}
        onRegenerate={generateEnrollmentCode}
      />
    </Card>
  )
}

function SummaryCount({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-md border bg-muted/30 px-3 py-2">
      <div className="text-lg font-medium leading-none">{value}</div>
      <div className="mt-1 text-xs text-muted-foreground">{label}</div>
    </div>
  )
}

function ConnectionDialog({
  open,
  onOpenChange,
  enrollmentCode,
  state,
  onRegenerate,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  enrollmentCode: EnrollmentCode | null
  state: MutationState
  onRegenerate: () => void
}) {
  const command = enrollmentCode
    ? `gentic worker connect ${enrollmentCode.code}`
    : "gentic worker connect ..."

  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Connect worker</AlertDialogTitle>
          <AlertDialogDescription>
            This creates a single-use code that expires after 10 minutes. A new
            code replaces any previous active code.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <div className="grid gap-3">
          <Label htmlFor="worker-connect-command">Command</Label>
          <div className="flex items-center gap-2 rounded-md border bg-muted p-3 font-mono text-sm">
            <code id="worker-connect-command" className="flex-1 break-all">
              {command}
            </code>
            <CopyButton
              value={command}
              disabled={!enrollmentCode}
              label="Copy command"
            />
          </div>
          <p className="flex items-center gap-1.5 text-sm text-muted-foreground">
            <IconClock className="size-4" />
            {enrollmentCode
              ? `Expires ${formatDateTime(enrollmentCode.expires_at)}`
              : "Generating expiration..."}
          </p>
          {state.status === "error" ? (
            <p className="text-sm text-destructive" role="alert">
              {state.message}
            </p>
          ) : null}
        </div>
        <AlertDialogFooter>
          <AlertDialogCancel>Close</AlertDialogCancel>
          <Button
            type="button"
            variant="outline"
            disabled={state.status === "pending"}
            onClick={onRegenerate}
          >
            <IconRefresh />
            {state.status === "pending" ? "Generating..." : "New code"}
          </Button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}

function CopyButton({
  value,
  label,
  disabled = false,
}: {
  value: string
  label: string
  disabled?: boolean
}) {
  const [copied, setCopied] = React.useState(false)
  const resetTimeoutRef = React.useRef<ReturnType<typeof setTimeout>>(null)

  React.useEffect(() => {
    return () => {
      if (resetTimeoutRef.current) clearTimeout(resetTimeoutRef.current)
    }
  }, [])

  async function copy() {
    try {
      await navigator.clipboard.writeText(value)
      setCopied(true)
      if (resetTimeoutRef.current) clearTimeout(resetTimeoutRef.current)
      resetTimeoutRef.current = setTimeout(() => setCopied(false), 2000)
    } catch {
      // Ignore clipboard failures (e.g. permission denied); the command
      // text remains visible and selectable for manual copying.
    }
  }

  return (
    <Button
      type="button"
      variant="ghost"
      size="icon-sm"
      className="shrink-0"
      disabled={disabled}
      aria-label={copied ? "Copied" : label}
      onClick={() => void copy()}
    >
      {copied ? (
        <IconCheck className="text-green-600 dark:text-green-400" />
      ) : (
        <IconCopy />
      )}
    </Button>
  )
}

function WorkerRow({
  worker,
  allWorkers,
  onRefresh,
  onDeleted,
}: {
  worker: SettingsWorker
  allWorkers: SettingsWorker[]
  onRefresh: () => Promise<unknown> | unknown
  onDeleted: (workerId: string) => void
}) {
  const [name, setName] = React.useState("")
  const [isEditingName, setIsEditingName] = React.useState(false)
  const [renameState, setRenameState] = React.useState<MutationState>({
    status: "idle",
  })
  const [banOpen, setBanOpen] = React.useState(false)
  const [deleteOpen, setDeleteOpen] = React.useState(false)
  const [typedDeleteName, setTypedDeleteName] = React.useState("")
  const [actionState, setActionState] = React.useState<MutationState>({
    status: "idle",
  })
  const nameInputRef = React.useRef<HTMLInputElement>(null)

  React.useEffect(() => {
    if (isEditingName) {
      nameInputRef.current?.focus()
      nameInputRef.current?.select()
    }
  }, [isEditingName])

  const duplicateName = allWorkers.some(
    (candidate) =>
      candidate.id !== worker.id &&
      normalizeWorkerName(candidate.editableName) === normalizeWorkerName(name),
  )
  const canDelete = typedDeleteName === worker.editableName

  async function submitRename(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const trimmedName = name.trim().replace(/\s+/g, " ")
    if (!trimmedName) {
      setRenameState({ status: "error", message: "Worker name is required." })
      return
    }
    if (duplicateName) {
      setRenameState({
        status: "error",
        message: "A worker with this name already exists.",
      })
      return
    }
    if (trimmedName === worker.editableName) {
      setIsEditingName(false)
      setRenameState({ status: "idle" })
      return
    }

    setRenameState({ status: "pending" })
    try {
      await requestJson(`/api/app/workers/${encodeURIComponent(worker.id)}`, {
        method: "PATCH",
        body: JSON.stringify({ display_name: trimmedName }),
      })
      setRenameState({ status: "idle" })
      setIsEditingName(false)
      await onRefresh()
    } catch (error) {
      setRenameState({
        status: "error",
        message: errorMessage(error, "Unable to rename worker."),
      })
    }
  }

  async function runWorkerAction(action: "ban" | "unban" | "delete") {
    setActionState({ status: "pending" })
    try {
      if (action === "delete") {
        await requestJson(`/api/app/workers/${encodeURIComponent(worker.id)}`, {
          method: "DELETE",
          body: JSON.stringify({}),
        })
        onDeleted(worker.id)
      } else {
        await postJson(
          `/api/app/workers/${encodeURIComponent(worker.id)}/${action}`,
        )
      }
      setActionState({ status: "idle" })
      setBanOpen(false)
      setDeleteOpen(false)
      setTypedDeleteName("")
      await onRefresh()
    } catch (error) {
      setActionState({
        status: "error",
        message: errorMessage(error, `Unable to ${action} worker.`),
      })
    }
  }

  return (
    <div className="rounded-md border p-3">
      <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
        <div className="min-w-0 flex-1">
          <form onSubmit={submitRename} className="grid gap-1">
            <div className="flex min-w-0 items-center gap-2">
              <IconServer className="size-4 shrink-0 text-muted-foreground" />
              {isEditingName ? (
                <Input
                  ref={nameInputRef}
                  value={name}
                  aria-label={`Worker name for ${worker.editableName}`}
                  aria-invalid={duplicateName || renameState.status === "error"}
                  className="h-8 max-w-sm"
                  maxLength={80}
                  disabled={renameState.status === "pending"}
                  onChange={(event) => {
                    setName(event.target.value)
                    setRenameState({ status: "idle" })
                  }}
                  onKeyDown={(event) => {
                    if (event.key === "Escape") {
                      setName(worker.editableName)
                      setIsEditingName(false)
                      setRenameState({ status: "idle" })
                    }
                  }}
                />
              ) : (
                <h3 className="truncate text-sm font-medium">
                  {worker.editableName}
                </h3>
              )}
              {!isEditingName ? (
                <Button
                  type="button"
                  variant="ghost"
                  size="icon-xs"
                  aria-label={`Rename ${worker.editableName}`}
                  onClick={() => {
                    setName(worker.editableName)
                    setIsEditingName(true)
                  }}
                >
                  <IconPencil />
                </Button>
              ) : (
                <Button
                  type="submit"
                  size="sm"
                  disabled={renameState.status === "pending"}
                >
                  Save
                </Button>
              )}
            </div>
            {duplicateName ? (
              <p className="text-xs text-destructive" role="alert">
                A worker with this name already exists.
              </p>
            ) : renameState.status === "error" ? (
              <p className="text-xs text-destructive" role="alert">
                {renameState.message}
              </p>
            ) : null}
          </form>
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <StatusBadge state={worker.primaryState} />
            <VersionBadge worker={worker} />
            {!worker.setupCompleted ? (
              <span className="rounded-md border px-2 py-0.5 text-xs text-muted-foreground">
                Setup incomplete
              </span>
            ) : null}
          </div>
        </div>
        <WorkerActions
          worker={worker}
          actionPending={actionState.status === "pending"}
          onBan={() => setBanOpen(true)}
          onUnban={() => void runWorkerAction("unban")}
          onDelete={() => setDeleteOpen(true)}
        />
      </div>

      <div className="mt-3 grid gap-2 text-sm sm:grid-cols-2 lg:grid-cols-4">
        <WorkerMetric
          label="Running"
          value={`${worker.runningCount}/${worker.configuredCapacity}`}
        />
        <WorkerMetric
          label="Last seen"
          value={
            worker.lastSeenAt ? formatRelative(worker.lastSeenAt) : "Never"
          }
        />
        <WorkerMetric
          label="OS / arch"
          value={
            [worker.os, worker.architecture].filter(Boolean).join(" / ") ||
            "Unknown"
          }
        />
        <WorkerMetric
          label="Uptime"
          value={
            worker.processStartedAt
              ? formatDurationSince(worker.processStartedAt)
              : "Not running"
          }
        />
        <WorkerMetric
          label="Connected"
          value={formatDate(worker.connectedAt)}
        />
        <WorkerMetric label="Tasks" value={`${worker.runningCount} active`} />
        <ProviderReadiness
          provider="Claude Code"
          readiness={worker.providers.claude_code}
        />
        <ProviderReadiness
          provider="Codex"
          readiness={worker.providers.codex}
        />
      </div>

      {actionState.status === "error" ? (
        <p className="mt-3 text-sm text-destructive" role="alert">
          {actionState.message}
        </p>
      ) : null}

      <AlertDialog open={banOpen} onOpenChange={setBanOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Ban {worker.editableName}?</AlertDialogTitle>
            <AlertDialogDescription>
              Banning this worker will interrupt and requeue{" "}
              {pluralize(worker.runningCount, "active task")}. The worker will
              remain visible and cannot claim new work until unbanned.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={actionState.status === "pending"}>
              Cancel
            </AlertDialogCancel>
            <AlertDialogAction
              variant="destructive"
              disabled={actionState.status === "pending"}
              onClick={(event) => {
                event.preventDefault()
                void runWorkerAction("ban")
              }}
            >
              {actionState.status === "pending" ? "Banning..." : "Ban worker"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog
        open={deleteOpen}
        onOpenChange={(open) => {
          setDeleteOpen(open)
          if (!open) setTypedDeleteName("")
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete {worker.editableName}?</AlertDialogTitle>
            <AlertDialogDescription>
              This permanently revokes the worker credential. Any active tasks
              assigned to this worker will be interrupted and requeued. Type the
              exact worker name to continue.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <div className="grid gap-2">
            <Label htmlFor={`delete-worker-${worker.id}`}>Worker name</Label>
            <Input
              id={`delete-worker-${worker.id}`}
              value={typedDeleteName}
              autoComplete="off"
              disabled={actionState.status === "pending"}
              onChange={(event) => setTypedDeleteName(event.target.value)}
            />
          </div>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={actionState.status === "pending"}>
              Cancel
            </AlertDialogCancel>
            <AlertDialogAction
              variant="destructive"
              disabled={!canDelete || actionState.status === "pending"}
              onClick={(event) => {
                event.preventDefault()
                void runWorkerAction("delete")
              }}
            >
              {actionState.status === "pending"
                ? "Deleting..."
                : "Delete worker"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}

function WorkerActions({
  worker,
  actionPending,
  onBan,
  onUnban,
  onDelete,
}: {
  worker: SettingsWorker
  actionPending: boolean
  onBan: () => void
  onUnban: () => void
  onDelete: () => void
}) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          type="button"
          variant="outline"
          size="icon-sm"
          aria-label={`Worker actions for ${worker.editableName}`}
          disabled={actionPending}
        >
          <IconDotsVertical />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        {worker.primaryState === "banned" ? (
          <DropdownMenuItem onSelect={onUnban}>
            <IconPlayerPlay />
            Unban
          </DropdownMenuItem>
        ) : (
          <DropdownMenuItem onSelect={onBan}>
            <IconBan />
            Ban
          </DropdownMenuItem>
        )}
        <DropdownMenuSeparator />
        <DropdownMenuItem variant="destructive" onSelect={onDelete}>
          <IconTrash />
          Delete
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

function StatusBadge({ state }: { state: SettingsWorker["primaryState"] }) {
  return (
    <span className="inline-flex items-center gap-1 rounded-md border px-2 py-0.5 text-xs text-muted-foreground">
      {state === "online" ? (
        <IconCheck className="size-3 text-green-600 dark:text-green-400" />
      ) : state === "banned" ? (
        <IconBan className="size-3 text-destructive" />
      ) : null}
      {primaryStateLabels[state]}
    </span>
  )
}

function VersionBadge({ worker }: { worker: SettingsWorker }) {
  return (
    <span className="inline-flex items-center gap-1 rounded-md border px-2 py-0.5 text-xs text-muted-foreground">
      {versionHealthLabels[worker.genticVersionHealth]}
      {worker.genticVersion ? ` ${worker.genticVersion}` : ""}
      {worker.genticVersionHealth !== "current"
        ? " - install the latest Gentic worker locally"
        : null}
    </span>
  )
}

function WorkerMetric({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-0 rounded-md bg-muted/30 px-2.5 py-2">
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className="truncate text-sm">{value}</div>
    </div>
  )
}

function ProviderReadiness({
  provider,
  readiness,
}: {
  provider: string
  readiness: SettingsWorker["providers"]["codex"]
}) {
  const state = readiness?.installed
    ? readiness.authenticated === false
      ? "Needs auth"
      : "Ready"
    : "Missing"
  const version = readiness?.version ? ` ${readiness.version}` : ""

  return <WorkerMetric label={provider} value={`${state}${version}`} />
}

async function postJson<T = unknown>(path: string): Promise<T> {
  return requestJson<T>(path, { method: "POST", body: JSON.stringify({}) })
}

async function requestJson<T = unknown>(
  path: string,
  init: RequestInit,
): Promise<T> {
  const response = await fetch(path, {
    ...init,
    credentials: "same-origin",
    headers: {
      "Content-Type": "application/json",
      Accept: "application/json",
      ...init.headers,
    },
  })

  if (!response.ok) {
    let message = "Request failed."
    try {
      const body = (await response.json()) as {
        error?: string | { message?: string }
      }
      message =
        typeof body.error === "string"
          ? body.error
          : body.error?.message || message
    } catch {
      // Keep the generic message when the response body is not JSON.
    }
    throw new Error(message)
  }

  return (await response.json()) as T
}

function normalizeWorkerName(value: string) {
  return value.trim().replace(/\s+/g, " ").toLowerCase()
}

function errorMessage(error: unknown, fallback: string) {
  return error instanceof Error && error.message ? error.message : fallback
}

function formatDateTime(value: string) {
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(value))
}

function formatDate(value: string) {
  return new Intl.DateTimeFormat(undefined, { dateStyle: "medium" }).format(
    new Date(value),
  )
}

function formatRelative(value: string) {
  const diffMs = Date.now() - new Date(value).getTime()
  if (diffMs < 60_000) return "just now"
  if (diffMs < 3_600_000) return `${Math.floor(diffMs / 60_000)}m ago`
  if (diffMs < 86_400_000) return `${Math.floor(diffMs / 3_600_000)}h ago`
  return `${Math.floor(diffMs / 86_400_000)}d ago`
}

function formatDurationSince(value: string) {
  const diffMs = Math.max(0, Date.now() - new Date(value).getTime())
  if (diffMs < 3_600_000) return `${Math.max(1, Math.floor(diffMs / 60_000))}m`
  if (diffMs < 86_400_000) return `${Math.floor(diffMs / 3_600_000)}h`
  return `${Math.floor(diffMs / 86_400_000)}d`
}

function pluralize(count: number, singular: string) {
  return `${count} ${singular}${count === 1 ? "" : "s"}`
}
