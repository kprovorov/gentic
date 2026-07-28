"use client"

import { IconCheck, IconChevronDown, IconCpu } from "@tabler/icons-react"

import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@gentic/ui/dropdown-menu"
import {
  agentModelOptions,
  type AgentProvider,
  type IssueModel,
} from "@gentic/validators/issues"

const defaultModelLabel = "Default model"

export function AgentModelPicker({
  agentProvider,
  issueModel,
  hasMessages,
  disabled,
  onIssueModelChange,
}: {
  agentProvider: AgentProvider
  issueModel: IssueModel
  hasMessages: boolean
  disabled?: boolean
  onIssueModelChange: (
    issueModel: IssueModel,
    info: { requiresReset: boolean }
  ) => void
}) {
  const options = agentModelOptions[agentProvider]
  const selectedOption = options.find((option) => option.value === issueModel)
  const label = selectedOption?.label ?? defaultModelLabel

  function handleSelect(nextModel: IssueModel) {
    if (nextModel === issueModel) {
      return
    }

    if (
      hasMessages &&
      !window.confirm(
        "Switch model? This resets the conversation and starts a fresh run."
      )
    ) {
      return
    }

    onIssueModelChange(nextModel, { requiresReset: hasMessages })
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          disabled={disabled}
          aria-label="Choose model"
          className="flex h-8 max-w-44 shrink-0 items-center gap-1.5 rounded-full px-2.5 text-xs font-medium text-muted-foreground hover:bg-muted disabled:pointer-events-none disabled:opacity-50"
        >
          <IconCpu className="size-3.5" />
          <span className="truncate">{label}</span>
          <IconChevronDown className="size-3.5" />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="min-w-48">
        <DropdownMenuItem onSelect={() => handleSelect(null)}>
          <IconCpu className="size-4" />
          {defaultModelLabel}
          {issueModel === null ? (
            <IconCheck className="ml-auto size-3.5" />
          ) : null}
        </DropdownMenuItem>
        {options.map((option) => (
          <DropdownMenuItem
            key={option.value}
            onSelect={() => handleSelect(option.value)}
          >
            <IconCpu className="size-4" />
            {option.label}
            {option.value === issueModel ? (
              <IconCheck className="ml-auto size-3.5" />
            ) : null}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
