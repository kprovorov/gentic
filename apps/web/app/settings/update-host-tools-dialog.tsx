"use client"

import * as React from "react"
import {
  IconCheck,
  IconChevronDown,
  IconLoader2,
  IconX,
} from "@tabler/icons-react"

import type { SettingsHost } from "@/app/queries"
import type {
  HostTool,
  HostToolUpdate,
  HostToolUpdateStatus,
} from "@gentic/validators/host-tool-updates"
import { Button } from "@gentic/ui/button"
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@gentic/ui/collapsible"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@gentic/ui/dialog"

const RESULT_POLL_MS = 2_000

type ToolRow = {
  tool: HostTool
  label: string
  /** What the update actually does on the host, in the owner's terms. */
  detail: string
}

const toolRows: ToolRow[] = [
  {
    tool: "gentic",
    label: "Gentic",
    detail:
      "Reinstalls gentic-cli from npm. The host restarts once its active tasks finish. Hosts running the standalone binary or a source checkout report the update as unsupported.",
  },
  {
    tool: "claude_code",
    label: "Claude Code",
    detail:
      "Runs claude update for the CLI on the host's PATH. The Claude Code build that serves sessions ships with Gentic, so update Gentic to move that version.",
  },
  {
    tool: "codex",
    label: "Codex",
    detail: "Upgrades the Codex CLI with Homebrew on macOS or npm on Linux.",
  },
  {
    tool: "github",
    label: "GitHub CLI",
    detail:
      "Upgrades gh with Homebrew on macOS or the system package manager on Linux (needs passwordless sudo unless the host runs as root).",
  },
]

const statusLabels: Record<HostToolUpdateStatus, string> = {
  waiting: "Waiting",
  updating: "Updating",
  updated: "Updated",
  failed: "Failed",
  "timed-out": "Timed out",
}

const ineligibilityMessages: Record<
  Exclude<SettingsHost["primaryState"], "online">,
  string
> = {
  offline: "This host is offline. Updates can be queued once it reconnects.",
  banned: "This host is banned. Unban it before updating its tools.",
  "setup-incomplete":
    "This host has not finished onboarding. Run gentic onboard on it first.",
}

type SubmitState =
  | { status: "idle" }
  | { status: "pending"; tool: HostTool }
  | { status: "error"; tool: HostTool; message: string }

/**
 * Per-host tool updates. The flow lives inside the dialog content, which
 * Radix unmounts on close, but unlike skill installs the results are read
 * back from the server on open: a command outlives its run for an hour, so
 * closing and reopening still shows what a recent update did.
 */
export function UpdateHostToolsDialog({
  host,
  open,
  onOpenChange,
}: {
  host: SettingsHost
  open: boolean
  onOpenChange: (open: boolean) => void
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl">
        <UpdateHostToolsFlow host={host} onClose={() => onOpenChange(false)} />
      </DialogContent>
    </Dialog>
  )
}

function UpdateHostToolsFlow({
  host,
  onClose,
}: {
  host: SettingsHost
  onClose: () => void
}) {
  const [updates, setUpdates] = React.useState<HostToolUpdate[] | null>(null)
  const [submit, setSubmit] = React.useState<SubmitState>({ status: "idle" })

  const path = `/api/app/hosts/${encodeURIComponent(host.id)}/tool-updates`
  const pending = (updates ?? []).some(isPending)

  React.useEffect(() => {
    let cancelled = false
    fetchUpdates(path).then(
      (next) => {
        if (!cancelled) setUpdates(next)
      },
      () => {
        if (!cancelled) setUpdates([])
      }
    )
    return () => {
      cancelled = true
    }
  }, [path])

  React.useEffect(() => {
    if (!pending) return

    const timer = setInterval(() => {
      // Leave the last known states in place on failure; the next tick retries.
      fetchUpdates(path).then(
        (next) => setUpdates(next),
        () => {}
      )
    }, RESULT_POLL_MS)
    return () => clearInterval(timer)
  }, [pending, path])

  async function update(tool: HostTool) {
    setSubmit({ status: "pending", tool })
    try {
      const data = await postJson<{ update: HostToolUpdate }>(path, { tool })
      setUpdates((current) => [...(current ?? []), data.update])
      setSubmit({ status: "idle" })
    } catch (error) {
      setSubmit({
        status: "error",
        tool,
        message: errorMessage(error, "Unable to queue this update."),
      })
    }
  }

  const ineligible =
    host.primaryState === "online"
      ? null
      : ineligibilityMessages[host.primaryState]

  return (
    <>
      <DialogHeader>
        <DialogTitle>Update tools on {host.editableName}</DialogTitle>
        <DialogDescription>
          Runs the tool&apos;s own updater on the host. Updates run one at a
          time and never interrupt tasks the host is already working on.
        </DialogDescription>
      </DialogHeader>

      <div className="grid gap-3">
        {ineligible ? (
          <p className="rounded-md border border-amber-500/40 bg-amber-500/5 p-3 text-sm">
            {ineligible}
          </p>
        ) : null}

        {toolRows.map((row) => (
          <ToolUpdateRow
            key={row.tool}
            row={row}
            host={host}
            latest={latestUpdate(updates, row.tool)}
            loading={updates === null}
            disabled={ineligible !== null || submit.status === "pending"}
            submit={submit}
            onUpdate={() => void update(row.tool)}
          />
        ))}
      </div>

      <DialogFooter>
        <Button type="button" variant="outline" onClick={onClose}>
          Close
        </Button>
      </DialogFooter>
    </>
  )
}

function ToolUpdateRow({
  row,
  host,
  latest,
  loading,
  disabled,
  submit,
  onUpdate,
}: {
  row: ToolRow
  host: SettingsHost
  latest: HostToolUpdate | null
  loading: boolean
  disabled: boolean
  submit: SubmitState
  onUpdate: () => void
}) {
  const inFlight = latest !== null && isPending(latest)
  const submitting = submit.status === "pending" && submit.tool === row.tool
  const error =
    submit.status === "error" && submit.tool === row.tool
      ? submit.message
      : null

  return (
    <div className="grid gap-2 rounded-md border p-3 text-sm">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex flex-wrap items-baseline gap-x-2">
            <span className="font-medium">{row.label}</span>
            <span className="text-xs text-muted-foreground">
              {installedVersion(host, row.tool)}
            </span>
          </div>
          <p className="mt-1 text-xs text-muted-foreground">{row.detail}</p>
        </div>
        <Button
          type="button"
          size="sm"
          variant="outline"
          className="shrink-0"
          disabled={disabled || loading || inFlight || submitting}
          aria-label={`Update ${row.label}`}
          onClick={onUpdate}
        >
          {submitting ? "Queuing..." : inFlight ? "Updating..." : "Update"}
        </Button>
      </div>

      {error ? (
        <p className="text-xs text-destructive" role="alert">
          {error}
        </p>
      ) : null}

      {latest ? <UpdateOutcome update={latest} /> : null}
    </div>
  )
}

function UpdateOutcome({ update }: { update: HostToolUpdate }) {
  return (
    <div className="grid gap-1 border-t pt-2">
      <div className="flex items-center gap-1.5 text-xs">
        {update.status === "updated" ? (
          <IconCheck className="size-3.5 text-green-600 dark:text-green-400" />
        ) : update.status === "failed" || update.status === "timed-out" ? (
          <IconX className="size-3.5 text-destructive" />
        ) : (
          <IconLoader2 className="size-3.5 animate-spin text-muted-foreground" />
        )}
        <span className="font-medium">{statusLabels[update.status]}</span>
        {update.summary ? (
          <span className="text-muted-foreground">{update.summary}</span>
        ) : null}
      </div>
      {update.output ? (
        <Collapsible>
          <CollapsibleTrigger asChild>
            <Button type="button" variant="ghost" size="sm">
              <IconChevronDown />
              Show output
            </Button>
          </CollapsibleTrigger>
          <CollapsibleContent>
            <pre className="mt-1.5 max-h-48 overflow-auto rounded-md bg-muted p-2 text-xs whitespace-pre-wrap">
              {update.output}
            </pre>
          </CollapsibleContent>
        </Collapsible>
      ) : null}
    </div>
  )
}

function isPending(update: HostToolUpdate) {
  return update.status === "waiting" || update.status === "updating"
}

/** The newest command for a tool; the list is oldest first. */
function latestUpdate(
  updates: HostToolUpdate[] | null,
  tool: HostTool
): HostToolUpdate | null {
  if (!updates) return null
  for (let index = updates.length - 1; index >= 0; index -= 1) {
    if (updates[index].tool === tool) return updates[index]
  }
  return null
}

function installedVersion(host: SettingsHost, tool: HostTool): string {
  if (tool === "gentic") {
    return host.genticVersion
      ? `Running ${host.genticVersion}`
      : "Version unknown"
  }

  const readiness = host.providers[tool]
  if (!readiness) return "Not reported by this host"
  if (!readiness.installed) return "Not installed"
  const version = readiness.version
    ? `Installed ${readiness.version}`
    : "Installed"
  return readiness.authenticated === false ? `${version}, needs auth` : version
}

async function fetchUpdates(path: string): Promise<HostToolUpdate[]> {
  const data = await requestJson<{ updates: HostToolUpdate[] }>(path, {
    method: "GET",
  })
  return data.updates
}

async function postJson<T>(path: string, body: unknown): Promise<T> {
  return requestJson<T>(path, { method: "POST", body: JSON.stringify(body) })
}

async function requestJson<T>(path: string, init: RequestInit): Promise<T> {
  const response = await fetch(path, {
    ...init,
    credentials: "same-origin",
    headers: {
      "Content-Type": "application/json",
      Accept: "application/json",
      ...init.headers,
    },
  })

  const body = (await response.json().catch(() => null)) as {
    error?: { message?: string }
  } | null

  if (!response.ok) {
    throw new Error(body?.error?.message ?? "Request failed.")
  }

  return body as T
}

function errorMessage(error: unknown, fallback: string) {
  return error instanceof Error && error.message ? error.message : fallback
}
