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
  IconPackageImport,
  IconPlugConnected,
  IconRefresh,
  IconServer,
  IconTrash,
} from "@tabler/icons-react"

import type { SettingsHost, SettingsHostsData } from "@/app/queries"
import { InstallSkillDialog } from "@/app/settings/install-skill-dialog"
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

type HostsSectionProps = {
  data: SettingsHostsData | undefined
  isLoading: boolean
  isError: boolean
  onRefresh: () => Promise<unknown> | unknown
}

const primaryStateLabels: Record<SettingsHost["primaryState"], string> = {
  "setup-incomplete": "Setup incomplete",
  online: "Online",
  offline: "Offline",
  banned: "Banned",
}

const versionHealthLabels: Record<SettingsHost["genticVersionHealth"], string> =
  {
    current: "Current",
    "update-available": "Update available",
    unsupported: "Unsupported",
  }

export function HostsSection({
  data,
  isLoading,
  isError,
  onRefresh,
}: HostsSectionProps) {
  const [connectOpen, setConnectOpen] = React.useState(false)
  const [installSkillOpen, setInstallSkillOpen] = React.useState(false)
  const [enrollmentCode, setEnrollmentCode] =
    React.useState<EnrollmentCode | null>(null)
  const [connectState, setConnectState] = React.useState<MutationState>({
    status: "idle",
  })
  const [hiddenDeletedHostIds, setHiddenDeletedHostIds] = React.useState(
    () => new Set<string>()
  )
  const hosts =
    data?.hosts.filter((host) => !hiddenDeletedHostIds.has(host.id)) ?? []
  const summary = data?.summary ?? { online: 0, offline: 0, banned: 0 }
  const setupIncomplete = hosts.filter(
    (host) => host.primaryState === "setup-incomplete"
  ).length

  async function generateEnrollmentCode() {
    setConnectState({ status: "pending" })
    try {
      const nextCode = await postJson<EnrollmentCode>(
        "/api/app/hosts/enrollment-code"
      )
      setEnrollmentCode(nextCode)
      setConnectState({ status: "idle" })
    } catch (error) {
      setConnectState({
        status: "error",
        message: errorMessage(error, "Unable to generate a host code."),
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
            <CardTitle>Hosts</CardTitle>
            <CardDescription>
              Manage the machines enrolled to claim and run tasks.
            </CardDescription>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button
              type="button"
              variant="outline"
              onClick={() => setInstallSkillOpen(true)}
            >
              <IconPackageImport />
              Install skill
            </Button>
            <Button type="button" onClick={openConnectDialog}>
              <IconPlugConnected />
              Connect host
            </Button>
          </div>
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
            Loading hosts...
          </div>
        ) : isError ? (
          <div className="flex items-center gap-2 rounded-md border border-destructive/30 bg-destructive/5 p-4 text-sm text-destructive">
            <IconAlertTriangle className="size-4" />
            Unable to load hosts.
          </div>
        ) : hosts.length === 0 ? (
          <div className="rounded-md border border-dashed p-4 text-sm text-muted-foreground">
            No hosts yet.
          </div>
        ) : (
          <div className="grid gap-3">
            {hosts.map((host) => (
              <HostRow
                key={host.id}
                host={host}
                allHosts={hosts}
                onRefresh={onRefresh}
                onDeleted={(hostId) =>
                  setHiddenDeletedHostIds((current) => {
                    const next = new Set(current)
                    next.add(hostId)
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

      <InstallSkillDialog
        open={installSkillOpen}
        onOpenChange={setInstallSkillOpen}
      />
    </Card>
  )
}

function SummaryCount({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-md border bg-muted/30 px-3 py-2">
      <div className="text-lg leading-none font-medium">{value}</div>
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
    ? `gentic host connect ${enrollmentCode.code}`
    : "gentic host connect ..."

  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Connect host</AlertDialogTitle>
          <AlertDialogDescription>
            This creates a single-use code that expires after 10 minutes. A new
            code replaces any previous active code.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <div className="grid gap-3">
          <Label htmlFor="host-connect-command">Command</Label>
          <div className="flex items-center gap-2 rounded-md border bg-muted p-3 font-mono text-sm">
            <code id="host-connect-command" className="flex-1 break-all">
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

function HostRow({
  host,
  allHosts,
  onRefresh,
  onDeleted,
}: {
  host: SettingsHost
  allHosts: SettingsHost[]
  onRefresh: () => Promise<unknown> | unknown
  onDeleted: (hostId: string) => void
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

  const duplicateName = allHosts.some(
    (candidate) =>
      candidate.id !== host.id &&
      normalizeHostName(candidate.editableName) === normalizeHostName(name)
  )
  const canDelete = typedDeleteName === host.editableName

  async function submitRename(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const trimmedName = name.trim().replace(/\s+/g, " ")
    if (!trimmedName) {
      setRenameState({
        status: "error",
        message: "A display name is required.",
      })
      return
    }
    if (duplicateName) {
      setRenameState({
        status: "error",
        message: "A host with this name already exists.",
      })
      return
    }
    if (trimmedName === host.editableName) {
      setIsEditingName(false)
      setRenameState({ status: "idle" })
      return
    }

    setRenameState({ status: "pending" })
    try {
      await requestJson(`/api/app/hosts/${encodeURIComponent(host.id)}`, {
        method: "PATCH",
        body: JSON.stringify({ display_name: trimmedName }),
      })
      setRenameState({ status: "idle" })
      setIsEditingName(false)
      await onRefresh()
    } catch (error) {
      setRenameState({
        status: "error",
        message: errorMessage(error, "Unable to rename host."),
      })
    }
  }

  async function runHostAction(action: "ban" | "unban" | "delete") {
    setActionState({ status: "pending" })
    try {
      if (action === "delete") {
        await requestJson(`/api/app/hosts/${encodeURIComponent(host.id)}`, {
          method: "DELETE",
          body: JSON.stringify({}),
        })
        onDeleted(host.id)
      } else {
        await postJson(
          `/api/app/hosts/${encodeURIComponent(host.id)}/${action}`
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
        message: errorMessage(error, `Unable to ${action} host.`),
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
                  aria-label={`Display name for ${host.editableName}`}
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
                      setName(host.editableName)
                      setIsEditingName(false)
                      setRenameState({ status: "idle" })
                    }
                  }}
                />
              ) : (
                <h3 className="truncate text-sm font-medium">
                  {host.editableName}
                </h3>
              )}
              {!isEditingName ? (
                <Button
                  type="button"
                  variant="ghost"
                  size="icon-xs"
                  aria-label={`Rename ${host.editableName}`}
                  onClick={() => {
                    setName(host.editableName)
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
                A host with this name already exists.
              </p>
            ) : renameState.status === "error" ? (
              <p className="text-xs text-destructive" role="alert">
                {renameState.message}
              </p>
            ) : null}
          </form>
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <StatusBadge state={host.primaryState} />
            <VersionBadge host={host} />
            {!host.setupCompleted ? (
              <span className="rounded-md border px-2 py-0.5 text-xs text-muted-foreground">
                Setup incomplete
              </span>
            ) : null}
          </div>
        </div>
        <HostActions
          host={host}
          actionPending={actionState.status === "pending"}
          onBan={() => setBanOpen(true)}
          onUnban={() => void runHostAction("unban")}
          onDelete={() => setDeleteOpen(true)}
        />
      </div>

      <div className="mt-3 grid gap-2 text-sm sm:grid-cols-2 lg:grid-cols-4">
        <HostMetric
          label="Running"
          value={`${host.runningCount}/${host.configuredCapacity}`}
        />
        <HostMetric
          label="Last seen"
          value={host.lastSeenAt ? formatRelative(host.lastSeenAt) : "Never"}
        />
        <HostMetric
          label="OS / arch"
          value={
            [host.os, host.architecture].filter(Boolean).join(" / ") ||
            "Unknown"
          }
        />
        <HostMetric
          label="Uptime"
          value={
            host.processStartedAt
              ? formatDurationSince(host.processStartedAt)
              : "Not running"
          }
        />
        <HostMetric label="Connected" value={formatDate(host.connectedAt)} />
        <HostMetric label="Tasks" value={`${host.runningCount} active`} />
        <ProviderReadiness
          provider="Claude Code"
          readiness={host.providers.claude_code}
        />
        <ProviderReadiness provider="Codex" readiness={host.providers.codex} />
      </div>

      {actionState.status === "error" ? (
        <p className="mt-3 text-sm text-destructive" role="alert">
          {actionState.message}
        </p>
      ) : null}

      <AlertDialog open={banOpen} onOpenChange={setBanOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Ban {host.editableName}?</AlertDialogTitle>
            <AlertDialogDescription>
              Banning this host will interrupt and requeue{" "}
              {pluralize(host.runningCount, "active task")}. The host will
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
                void runHostAction("ban")
              }}
            >
              {actionState.status === "pending" ? "Banning..." : "Ban host"}
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
            <AlertDialogTitle>Delete {host.editableName}?</AlertDialogTitle>
            <AlertDialogDescription>
              This permanently revokes the host credential. Any active tasks
              assigned to this host will be interrupted and requeued. Type its
              exact display name to continue.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <div className="grid gap-2">
            <Label htmlFor={`delete-host-${host.id}`}>Display name</Label>
            <Input
              id={`delete-host-${host.id}`}
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
                void runHostAction("delete")
              }}
            >
              {actionState.status === "pending" ? "Deleting..." : "Delete host"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}

function HostActions({
  host,
  actionPending,
  onBan,
  onUnban,
  onDelete,
}: {
  host: SettingsHost
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
          aria-label={`Host actions for ${host.editableName}`}
          disabled={actionPending}
        >
          <IconDotsVertical />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        {host.primaryState === "banned" ? (
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

function StatusBadge({ state }: { state: SettingsHost["primaryState"] }) {
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

function VersionBadge({ host }: { host: SettingsHost }) {
  return (
    <span className="inline-flex items-center gap-1 rounded-md border px-2 py-0.5 text-xs text-muted-foreground">
      {versionHealthLabels[host.genticVersionHealth]}
      {host.genticVersion ? ` ${host.genticVersion}` : ""}
      {host.genticVersionHealth !== "current"
        ? " - update the Gentic CLI on this host"
        : null}
    </span>
  )
}

function HostMetric({ label, value }: { label: string; value: string }) {
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
  readiness: SettingsHost["providers"]["codex"]
}) {
  const state = readiness?.installed
    ? readiness.authenticated === false
      ? "Needs auth"
      : "Ready"
    : "Missing"
  const version = readiness?.version ? ` ${readiness.version}` : ""

  return <HostMetric label={provider} value={`${state}${version}`} />
}

async function postJson<T = unknown>(path: string): Promise<T> {
  return requestJson<T>(path, { method: "POST", body: JSON.stringify({}) })
}

async function requestJson<T = unknown>(
  path: string,
  init: RequestInit
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

function normalizeHostName(value: string) {
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
    new Date(value)
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
