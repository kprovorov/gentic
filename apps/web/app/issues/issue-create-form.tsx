"use client"

import Link from "next/link"
import { useRef, useState } from "react"
import { IconChevronDown, IconDeviceFloppy } from "@tabler/icons-react"

import { runIssue, saveIssueDraft } from "@/app/issues/actions"
import type { ProjectOption } from "@/app/queries"
import { AgentProviderIcon } from "@/components/agent-provider-icon"
import { Button } from "@gentic/ui/button"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@gentic/ui/dropdown-menu"
import { NativeSelect, NativeSelectOption } from "@gentic/ui/native-select"
import type { AgentProvider } from "@gentic/validators/issues"

import { AttachmentPromptField } from "./attachment-prompt-field"
import {
  agentProviderLabels,
  agentProviderOptions,
} from "./agent-provider-options"

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
  const [projectError, setProjectError] = useState("")
  const formRef = useRef<HTMLFormElement>(null)
  const projectSelectRef = useRef<HTMLSelectElement>(null)
  const agentProviderRef = useRef<HTMLInputElement>(null)
  const codexSubmitRef = useRef<HTMLButtonElement>(null)
  const draftSubmitRef = useRef<HTMLButtonElement>(null)
  const projectErrorId = "issue-project-error"
  const requireProject = () => {
    const projectSelect = projectSelectRef.current
    if (!projectSelect || projectSelect.value) {
      return true
    }

    setProjectError("Select a project before running this issue.")
    projectSelect.focus()
    return false
  }
  const setAgentProvider = (agentProvider: AgentProvider) => {
    if (agentProviderRef.current) {
      agentProviderRef.current.value = agentProvider
    }
  }
  const alternateAgentProvider =
    agentProviderOptions.find((option) => option.value !== defaultAgentProvider)
      ?.value ?? "codex"

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
    <form
      ref={formRef}
      action={saveIssueDraft}
      encType="multipart/form-data"
      className={className}
      id="new-issue-form"
      onInvalidCapture={(event) => {
        if (event.target === projectSelectRef.current) {
          setProjectError("Select a project before running this issue.")
        }
      }}
    >
      <input
        ref={agentProviderRef}
        type="hidden"
        name="agent_provider"
        defaultValue={defaultAgentProvider}
      />
      <button
        ref={codexSubmitRef}
        type="submit"
        formAction={runIssue}
        className="hidden"
        tabIndex={-1}
        aria-hidden="true"
      />
      <button
        ref={draftSubmitRef}
        type="submit"
        formAction={saveIssueDraft}
        className="hidden"
        tabIndex={-1}
        aria-hidden="true"
      />

      <label className="sr-only" htmlFor="issue-prompt">
        Prompt
      </label>
      <AttachmentPromptField
        id="issue-prompt"
        name="prompt"
        value={prompt}
        onChange={setPrompt}
        rows={5}
        placeholder="Describe what you want built, fixed, or investigated."
        required
        className="bg-background ring-border rounded-[1.75rem] shadow-sm ring-1"
        textareaClassName="min-h-36 resize-none px-5 py-4 text-base md:text-base"
        footerStart={
          <div className="flex min-w-0 flex-col gap-1">
            <label className="sr-only" htmlFor="issue-project">
              Project
            </label>
            <NativeSelect
              ref={projectSelectRef}
              name="project_id"
              required
              defaultValue=""
              id="issue-project"
              size="sm"
              aria-invalid={projectError ? true : undefined}
              aria-describedby={projectError ? projectErrorId : undefined}
              className="max-w-full min-w-0 sm:w-56"
              onChange={() => setProjectError("")}
            >
              <NativeSelectOption value="" disabled hidden>
                Select project
              </NativeSelectOption>
              {projects.map((project) => (
                <NativeSelectOption key={project.id} value={project.id}>
                  {project.name} ({project.repo})
                </NativeSelectOption>
              ))}
            </NativeSelect>
            {projectError ? (
              <p id={projectErrorId} className="text-xs text-destructive">
                {projectError}
              </p>
            ) : null}
          </div>
        }
        footerEnd={
          <div className="ml-auto flex min-w-0 items-center">
            <Button
              type="submit"
              formAction={runIssue}
              className="border-r-primary-foreground/25 min-w-0 flex-1 rounded-r-none sm:flex-initial"
              onClick={(event) => {
                setAgentProvider(defaultAgentProvider)
                if (!requireProject()) {
                  event.preventDefault()
                }
              }}
            >
              <AgentProviderIcon provider={defaultAgentProvider} tone="mono" />
              <span className="truncate">
                Run with {agentProviderLabels[defaultAgentProvider]}
              </span>
            </Button>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button
                  type="button"
                  aria-label="Choose submit action"
                  className="border-l-primary-foreground/25 shrink-0 rounded-l-none px-2"
                >
                  <IconChevronDown />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="min-w-48">
                <DropdownMenuItem
                  onSelect={() => {
                    if (!requireProject()) {
                      return
                    }
                    setAgentProvider(alternateAgentProvider)
                    formRef.current?.requestSubmit(
                      codexSubmitRef.current ?? undefined
                    )
                  }}
                >
                  <AgentProviderIcon provider={alternateAgentProvider} />
                  Run with {agentProviderLabels[alternateAgentProvider]}
                </DropdownMenuItem>
                <DropdownMenuItem
                  onSelect={() => {
                    setAgentProvider(defaultAgentProvider)
                    formRef.current?.requestSubmit(
                      draftSubmitRef.current ?? undefined
                    )
                  }}
                >
                  <IconDeviceFloppy />
                  Save draft
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        }
      />
    </form>
  )
}
