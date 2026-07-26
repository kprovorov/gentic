"use client"

import { IconCheck, IconChevronDown } from "@tabler/icons-react"

import { AgentProviderIcon } from "@/components/agent-provider-icon"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@gentic/ui/dropdown-menu"
import type { AgentProvider } from "@gentic/validators/issues"

import {
  agentProviderLabels,
  agentProviderOptions,
} from "../agent-provider-options"
import {
  buildAgentSwitchConfirmMessage,
  resolveAgentProviderSelection,
} from "./agent-provider-selection"

export function AgentProviderPicker({
  agentProvider,
  hasMessages,
  disabled,
  onAgentProviderChange,
}: {
  agentProvider: AgentProvider
  hasMessages: boolean
  disabled?: boolean
  onAgentProviderChange: (
    provider: AgentProvider,
    info: { requiresReset: boolean }
  ) => void
}) {
  function handleSelect(nextProvider: AgentProvider) {
    const result = resolveAgentProviderSelection({
      currentProvider: agentProvider,
      nextProvider,
      hasMessages,
    })

    if (result.type === "noop") {
      return
    }

    if (
      result.requiresReset &&
      !window.confirm(
        buildAgentSwitchConfirmMessage(agentProviderLabels[nextProvider])
      )
    ) {
      return
    }

    onAgentProviderChange(nextProvider, {
      requiresReset: result.requiresReset,
    })
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          disabled={disabled}
          aria-label="Choose agent"
          className="flex h-8 shrink-0 items-center gap-1.5 rounded-full px-2.5 text-xs font-medium text-muted-foreground hover:bg-muted disabled:pointer-events-none disabled:opacity-50"
        >
          <AgentProviderIcon provider={agentProvider} className="size-3.5" />
          {agentProviderLabels[agentProvider]}
          <IconChevronDown className="size-3.5" />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="min-w-44">
        {agentProviderOptions.map((option) => (
          <DropdownMenuItem
            key={option.value}
            onSelect={() => handleSelect(option.value)}
          >
            <AgentProviderIcon provider={option.value} className="size-4" />
            {option.label}
            {option.value === agentProvider ? (
              <IconCheck className="ml-auto size-3.5" />
            ) : null}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
