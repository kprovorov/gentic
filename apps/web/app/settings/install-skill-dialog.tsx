"use client"

import * as React from "react"
import {
  IconAlertTriangle,
  IconCheck,
  IconChevronDown,
  IconShieldCheck,
  IconX,
} from "@tabler/icons-react"

import type {
  SkillAudit,
  SkillAuditGate,
  SkillAuditGateReason,
  WorkerSkillInstallStatus,
} from "@gentic/validators/skills"
import { Button } from "@gentic/ui/button"
import { Checkbox } from "@gentic/ui/checkbox"
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
import { Input } from "@gentic/ui/input"
import { Label } from "@gentic/ui/label"

const TARGET_POLL_MS = 10_000
const RESULT_POLL_MS = 2_000
const URL_DEBOUNCE_MS = 400

type SkillIdentity = {
  source: string
  skill: string
  url: string
}

type InstallTarget = {
  worker_id: string
  display_name: string
  eligible: boolean
  reason: "offline" | "banned" | "setup-incomplete" | "installing" | null
}

type WorkerSkillInstall = {
  id: string
  worker_id: string
  status: WorkerSkillInstallStatus
  error_summary: string | null
  output: string | null
}

/** `url` is the trimmed input this result was fetched for. */
type AuditState =
  | { status: "idle"; url: string }
  | { status: "checking"; url: string }
  | { status: "invalid"; url: string; message: string }
  | {
      status: "ready"
      url: string
      skill: SkillIdentity
      gate: SkillAuditGate
    }

type SubmitState =
  | { status: "idle" }
  | { status: "pending" }
  | { status: "error"; message: string }

const reasonLabels: Record<NonNullable<InstallTarget["reason"]>, string> = {
  offline: "Offline",
  banned: "Banned",
  "setup-incomplete": "Setup incomplete",
  installing: "Installing another skill",
}

const gateReasonLabels: Record<SkillAuditGateReason, string> = {
  failed: "A security audit failed for this skill.",
  warning: "A security audit raised a warning.",
  stale: "Some audits are missing a date or are older than 30 days.",
  missing: "No security audit has been published for this skill yet.",
  unavailable: "Audit results could not be loaded from skills.sh.",
}

const installStatusLabels: Record<WorkerSkillInstallStatus, string> = {
  waiting: "Waiting",
  installing: "Installing",
  installed: "Installed",
  failed: "Failed",
  "timed-out": "Timed out",
}

/**
 * The flow lives entirely inside the dialog content, which Radix unmounts on
 * close. That is what makes results transient: there is no state left to show
 * when the dialog is reopened, and no install history anywhere in the UI.
 */
export function InstallSkillDialog({
  open,
  onOpenChange,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl">
        <InstallSkillFlow onClose={() => onOpenChange(false)} />
      </DialogContent>
    </Dialog>
  )
}

function InstallSkillFlow({ onClose }: { onClose: () => void }) {
  const [url, setUrl] = React.useState("")
  const [audit, setAudit] = React.useState<AuditState>({
    status: "idle",
    url: "",
  })
  const [targets, setTargets] = React.useState<InstallTarget[] | null>(null)
  const [selected, setSelected] = React.useState<Set<string> | null>(null)
  const [acceptRisk, setAcceptRisk] = React.useState(false)
  const [submit, setSubmit] = React.useState<SubmitState>({ status: "idle" })
  const [installs, setInstalls] = React.useState<WorkerSkillInstall[] | null>(
    null,
  )

  const dispatched = installs !== null
  const trimmedUrl = url.trim()
  // Audit results belong to the URL they were fetched for, so editing the
  // field falls back to "checking" without an extra render pass.
  const auditState: AuditState = !trimmedUrl
    ? { status: "idle", url: "" }
    : audit.url === trimmedUrl
      ? audit
      : { status: "checking", url: trimmedUrl }

  React.useEffect(() => {
    if (dispatched) return

    let cancelled = false
    const load = async () => {
      try {
        const data = await getJson<{ workers: InstallTarget[] }>(
          "/api/app/skills/install-targets",
        )
        if (cancelled) return
        setTargets(data.workers)
        setSelected((current) =>
          current
            ? // Keep an explicit choice, but never keep a worker the server
              // would now refuse.
              new Set(
                data.workers
                  .filter(
                    (worker) => worker.eligible && current.has(worker.worker_id),
                  )
                  .map((worker) => worker.worker_id),
              )
            : new Set(
                data.workers
                  .filter((worker) => worker.eligible)
                  .map((worker) => worker.worker_id),
              ),
        )
      } catch {
        if (!cancelled) setTargets([])
      }
    }

    void load()
    const timer = setInterval(() => void load(), TARGET_POLL_MS)
    return () => {
      cancelled = true
      clearInterval(timer)
    }
  }, [dispatched])

  React.useEffect(() => {
    if (dispatched || !trimmedUrl) return

    let cancelled = false
    const timer = setTimeout(async () => {
      try {
        const data = await getJson<{ skill: SkillIdentity; gate: SkillAuditGate }>(
          `/api/app/skills/audit?url=${encodeURIComponent(trimmedUrl)}`,
        )
        if (!cancelled) {
          setAudit({
            status: "ready",
            url: trimmedUrl,
            skill: data.skill,
            gate: data.gate,
          })
          setAcceptRisk(false)
        }
      } catch (error) {
        if (!cancelled) {
          setAudit({
            status: "invalid",
            url: trimmedUrl,
            message: errorMessage(error, "Unable to check this skill."),
          })
        }
      }
    }, URL_DEBOUNCE_MS)

    return () => {
      cancelled = true
      clearTimeout(timer)
    }
  }, [dispatched, trimmedUrl])

  const pendingIds = (installs ?? [])
    .filter(
      (install) =>
        install.status === "waiting" || install.status === "installing",
    )
    .map((install) => install.id)
  const pendingKey = pendingIds.join(",")

  React.useEffect(() => {
    if (!pendingKey) return

    let cancelled = false
    const timer = setInterval(async () => {
      try {
        const data = await getJson<{ installs: WorkerSkillInstall[] }>(
          `/api/app/skills/installs?ids=${encodeURIComponent(pendingKey)}`,
        )
        if (cancelled) return
        setInstalls((current) =>
          (current ?? []).map(
            (install) =>
              data.installs.find((next) => next.id === install.id) ?? install,
          ),
        )
      } catch {
        // Leave the last known states in place; the next tick retries.
      }
    }, RESULT_POLL_MS)

    return () => {
      cancelled = true
      clearInterval(timer)
    }
  }, [pendingKey])

  const gate = auditState.status === "ready" ? auditState.gate : null
  const selectedIds = selected ? [...selected] : []
  const canInstall =
    auditState.status === "ready" &&
    gate?.decision !== "block" &&
    selectedIds.length > 0 &&
    (gate?.decision !== "confirm" || acceptRisk) &&
    submit.status !== "pending"

  async function install() {
    if (auditState.status !== "ready") return

    setSubmit({ status: "pending" })
    try {
      const data = await postJson<{ installs: WorkerSkillInstall[] }>(
        "/api/app/skills/installs",
        {
          url: auditState.skill.url,
          worker_ids: selectedIds,
          accept_risk: acceptRisk,
        },
      )
      setSubmit({ status: "idle" })
      setInstalls(data.installs)
    } catch (error) {
      if (error instanceof ApiError && error.gate) {
        setAudit({
          status: "ready",
          url: auditState.url,
          skill: auditState.skill,
          gate: error.gate,
        })
        setAcceptRisk(false)
      }
      setSubmit({
        status: "error",
        message: errorMessage(error, "Unable to install this skill."),
      })
    }
  }

  return (
    <>
      <DialogHeader>
        <DialogTitle>Install skill</DialogTitle>
        <DialogDescription>
          Installs one skill from skills.sh on the workers you select, for
          both Claude Code and Codex. Results are shown here while the dialog
          stays open and are not kept afterwards.
        </DialogDescription>
      </DialogHeader>

      <div className="grid gap-4">
        <div className="grid gap-2">
          <Label htmlFor="install-skill-url">Skill URL</Label>
          <Input
            id="install-skill-url"
            value={url}
            placeholder="https://skills.sh/owner/repo/skill"
            autoComplete="off"
            spellCheck={false}
            disabled={dispatched}
            aria-invalid={auditState.status === "invalid"}
            onChange={(event) => setUrl(event.target.value)}
          />
          {auditState.status === "checking" ? (
            <p className="text-sm text-muted-foreground">
              Checking security audits...
            </p>
          ) : auditState.status === "invalid" ? (
            <p className="text-sm text-destructive" role="alert">
              {auditState.message}
            </p>
          ) : auditState.status === "ready" ? (
            <p className="text-sm text-muted-foreground">
              <span className="font-medium text-foreground">
                {auditState.skill.skill}
              </span>{" "}
              from {auditState.skill.source}
            </p>
          ) : null}
        </div>

        {gate ? <AuditPanel gate={gate} /> : null}

        {dispatched ? (
          <InstallResults
            installs={installs ?? []}
            targets={targets ?? []}
          />
        ) : (
          <WorkerPicker
            targets={targets}
            selected={selected}
            onToggle={(workerId, checked) =>
              setSelected((current) => {
                const next = new Set(current ?? [])
                if (checked) next.add(workerId)
                else next.delete(workerId)
                return next
              })
            }
          />
        )}

        {!dispatched && gate?.decision === "confirm" ? (
          <label className="flex items-start gap-2 rounded-md border border-amber-500/40 bg-amber-500/5 p-3 text-sm">
            <Checkbox
              checked={acceptRisk}
              aria-label="Accept the risk and install anyway"
              onCheckedChange={(checked) => setAcceptRisk(checked === true)}
            />
            <span>
              I understand the audit results above and want to install this
              skill anyway.
            </span>
          </label>
        ) : null}

        {submit.status === "error" ? (
          <p className="text-sm text-destructive" role="alert">
            {submit.message}
          </p>
        ) : null}
      </div>

      <DialogFooter>
        <Button type="button" variant="outline" onClick={onClose}>
          Close
        </Button>
        {dispatched ? null : (
          <Button
            type="button"
            disabled={!canInstall}
            onClick={() => void install()}
          >
            {submit.status === "pending"
              ? "Installing..."
              : `Install on ${selectedIds.length} ${
                  selectedIds.length === 1 ? "worker" : "workers"
                }`}
          </Button>
        )}
      </DialogFooter>
    </>
  )
}

function AuditPanel({ gate }: { gate: SkillAuditGate }) {
  return (
    <div className="grid gap-2 rounded-md border p-3">
      <div className="flex items-center gap-2 text-sm font-medium">
        {gate.decision === "allow" ? (
          <IconShieldCheck className="size-4 text-green-600 dark:text-green-400" />
        ) : (
          <IconAlertTriangle
            className={
              gate.decision === "block"
                ? "size-4 text-destructive"
                : "size-4 text-amber-600 dark:text-amber-400"
            }
          />
        )}
        {gate.decision === "allow"
          ? "All available audits are current and passing"
          : gate.decision === "block"
            ? "Installation blocked by a failed audit"
            : "Audits need your confirmation"}
      </div>

      {gate.reasons.length > 0 ? (
        <ul className="grid gap-1 text-sm text-muted-foreground">
          {gate.reasons.map((reason) => (
            <li key={reason}>{gateReasonLabels[reason]}</li>
          ))}
        </ul>
      ) : null}

      {gate.audits.length > 0 ? (
        <ul className="grid gap-1.5">
          {gate.audits.map((audit) => (
            <AuditRow key={`${audit.provider}-${audit.slug ?? ""}`} audit={audit} />
          ))}
        </ul>
      ) : null}
    </div>
  )
}

function AuditRow({ audit }: { audit: SkillAudit }) {
  return (
    <li className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5 text-sm">
      <span className="font-medium">{audit.provider}</span>
      <span
        className={
          audit.status === "fail"
            ? "text-destructive"
            : audit.status === "warn"
              ? "text-amber-600 dark:text-amber-400"
              : "text-green-600 dark:text-green-400"
        }
      >
        {audit.status}
      </span>
      {audit.auditedAt ? (
        <span className="text-xs text-muted-foreground">
          {formatAuditDate(audit.auditedAt)}
        </span>
      ) : null}
      {audit.summary ? (
        <span className="w-full text-xs text-muted-foreground">
          {audit.summary}
        </span>
      ) : null}
    </li>
  )
}

function WorkerPicker({
  targets,
  selected,
  onToggle,
}: {
  targets: InstallTarget[] | null
  selected: Set<string> | null
  onToggle: (workerId: string, checked: boolean) => void
}) {
  if (targets === null) {
    return (
      <div className="rounded-md border border-dashed p-3 text-sm text-muted-foreground">
        Loading workers...
      </div>
    )
  }
  if (targets.length === 0) {
    return (
      <div className="rounded-md border border-dashed p-3 text-sm text-muted-foreground">
        No connected workers yet.
      </div>
    )
  }

  return (
    <fieldset className="grid gap-2">
      <legend className="mb-2 text-sm font-medium">Workers</legend>
      {targets.map((target) => (
        <label
          key={target.worker_id}
          className="flex items-center justify-between gap-3 rounded-md border p-2.5 text-sm has-disabled:opacity-60"
        >
          <span className="flex min-w-0 items-center gap-2">
            <Checkbox
              checked={selected?.has(target.worker_id) ?? false}
              disabled={!target.eligible}
              aria-label={`Install on ${target.display_name}`}
              onCheckedChange={(checked) =>
                onToggle(target.worker_id, checked === true)
              }
            />
            <span className="truncate">{target.display_name}</span>
          </span>
          {target.reason ? (
            <span className="shrink-0 text-xs text-muted-foreground">
              {reasonLabels[target.reason]}
            </span>
          ) : null}
        </label>
      ))}
    </fieldset>
  )
}

function InstallResults({
  installs,
  targets,
}: {
  installs: WorkerSkillInstall[]
  targets: InstallTarget[]
}) {
  const names = new Map(
    targets.map((target) => [target.worker_id, target.display_name]),
  )

  return (
    <div className="grid gap-2">
      <h3 className="text-sm font-medium">Results</h3>
      {installs.map((install) => (
        <div key={install.id} className="rounded-md border p-2.5 text-sm">
          <div className="flex items-center justify-between gap-3">
            <span className="truncate">
              {names.get(install.worker_id) ?? "Worker"}
            </span>
            <span className="flex shrink-0 items-center gap-1.5 text-xs">
              {install.status === "installed" ? (
                <IconCheck className="size-3.5 text-green-600 dark:text-green-400" />
              ) : install.status === "failed" ||
                install.status === "timed-out" ? (
                <IconX className="size-3.5 text-destructive" />
              ) : null}
              {installStatusLabels[install.status]}
            </span>
          </div>
          {install.error_summary ? (
            <p className="mt-1.5 text-xs text-muted-foreground">
              {install.error_summary}
            </p>
          ) : null}
          {install.output ? (
            <Collapsible className="mt-1.5">
              <CollapsibleTrigger asChild>
                <Button type="button" variant="ghost" size="sm">
                  <IconChevronDown />
                  Show output
                </Button>
              </CollapsibleTrigger>
              <CollapsibleContent>
                <pre className="mt-1.5 max-h-48 overflow-auto rounded-md bg-muted p-2 text-xs whitespace-pre-wrap">
                  {install.output}
                </pre>
              </CollapsibleContent>
            </Collapsible>
          ) : null}
        </div>
      ))}
    </div>
  )
}

class ApiError extends Error {
  readonly gate: SkillAuditGate | null

  constructor(message: string, gate: SkillAuditGate | null) {
    super(message)
    this.name = "ApiError"
    this.gate = gate
  }
}

async function getJson<T>(path: string): Promise<T> {
  return requestJson<T>(path, { method: "GET" })
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
    gate?: SkillAuditGate
  } | null

  if (!response.ok) {
    throw new ApiError(
      body?.error?.message ?? "Request failed.",
      body?.gate ?? null,
    )
  }

  return body as T
}

function errorMessage(error: unknown, fallback: string) {
  return error instanceof Error && error.message ? error.message : fallback
}

function formatAuditDate(value: string) {
  const parsed = new Date(value)
  return Number.isNaN(parsed.getTime())
    ? value
    : new Intl.DateTimeFormat(undefined, { dateStyle: "medium" }).format(parsed)
}
