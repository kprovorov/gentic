"use client"

import Link from "next/link"
import { useRef, useState } from "react"
import { IconDeviceFloppy, IconSend } from "@tabler/icons-react"

import { runIssue, saveIssueDraft } from "@/app/issues/actions"
import type { ProjectOption } from "@/app/queries"
import { Button } from "@gentic/ui/button"
import { NativeSelect, NativeSelectOption } from "@gentic/ui/native-select"
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
  const [projectError, setProjectError] = useState("")
  const projectSelectRef = useRef<HTMLSelectElement>(null)
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
      onInvalidCapture={(event) => {
        if (event.target === projectSelectRef.current) {
          setProjectError("Select a project before running this issue.")
        }
      }}
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
