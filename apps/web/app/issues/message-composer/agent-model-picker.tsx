"use client"

import { IconCheck, IconChevronDown } from "@tabler/icons-react"

import { AgentProviderIcon } from "@/components/agent-provider-icon"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@gentic/ui/dropdown-menu"
import { cn } from "@gentic/ui/utils"
import {
  agentModelOptions,
  type AgentProvider,
  type IssueModel,
} from "@gentic/validators/issues"

import {
  agentProviderLabels,
  agentProviderOptions,
} from "../agent-provider-options"
import {
  buildAgentModelSwitchConfirmMessage,
  resolveAgentModelSelection,
} from "./agent-model-selection"

function defaultModelLabel(agentProvider: AgentProvider): string {
  return `${agentProviderLabels[agentProvider]} default`
}

// Single dropdown replacing the former separate agent + model pickers: every
// model from every agent is listed here, grouped by agent, so picking a
// model also picks the agent that runs it in one step.
export function AgentModelPicker({
  agentProvider,
  issueModel,
  hasMessages,
  disabled,
  onAgentModelChange,
  className,
}: {
  agentProvider: AgentProvider
  issueModel: IssueModel
  hasMessages: boolean
  disabled?: boolean
  onAgentModelChange: (
    agentProvider: AgentProvider,
    issueModel: IssueModel,
    info: { requiresReset: boolean }
  ) => void
  className?: string
}) {
  const selectedOption = agentModelOptions[agentProvider].find(
    (option) => option.value === issueModel
  )
  const label = selectedOption?.label ?? defaultModelLabel(agentProvider)

  function handleSelect(nextProvider: AgentProvider, nextModel: IssueModel) {
    const result = resolveAgentModelSelection({
      currentProvider: agentProvider,
      currentModel: issueModel,
      nextProvider,
      nextModel,
      hasMessages,
    })

    if (result.type === "noop") {
      return
    }

    if (
      result.requiresReset &&
      !window.confirm(
        buildAgentModelSwitchConfirmMessage({
          providerChanged: nextProvider !== agentProvider,
          agentLabel: agentProviderLabels[nextProvider],
        })
      )
    ) {
      return
    }

    onAgentModelChange(nextProvider, nextModel, {
      requiresReset: result.requiresReset,
    })
  }

  return (
    // Non-modal: this picker can be nested inside a Dialog (New Issue),
    // whose default-modal DropdownMenu would disable pointer events on the
    // trigger while open, so a second click meant to close it falls through
    // to the Dialog's overlay and closes the whole dialog instead.
    <DropdownMenu modal={false}>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          disabled={disabled}
          aria-label="Choose agent and model"
          className={cn(
            "flex h-8 max-w-56 shrink-0 items-center gap-1.5 rounded-full px-2.5 text-xs font-medium text-muted-foreground hover:bg-muted disabled:pointer-events-none disabled:opacity-50",
            className
          )}
        >
          <AgentProviderIcon provider={agentProvider} className="size-3.5" />
          <span className="truncate">{label}</span>
          <IconChevronDown className="size-3.5" />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="min-w-56">
        {agentProviderOptions.map((providerOption, index) => (
          <div key={providerOption.value}>
            {index > 0 ? <DropdownMenuSeparator /> : null}
            <DropdownMenuLabel>{providerOption.label}</DropdownMenuLabel>
            {agentModelOptions[providerOption.value].map((option) => (
              <DropdownMenuItem
                key={option.value}
                onSelect={() =>
                  handleSelect(providerOption.value, option.value)
                }
              >
                <AgentProviderIcon
                  provider={providerOption.value}
                  className="size-4"
                />
                {option.label}
                {providerOption.value === agentProvider &&
                option.value === issueModel ? (
                  <IconCheck className="ml-auto size-3.5" />
                ) : null}
              </DropdownMenuItem>
            ))}
          </div>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
