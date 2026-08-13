"use client"

import { useRef } from "react"
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
  open,
  onOpenChange,
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
  // Controlled by the chat composer, which has to know the menu is open: it
  // lives in a portal, so opening it takes focus out of the composer.
  open?: boolean
  onOpenChange?: (open: boolean) => void
  className?: string
}) {
  const selectedOption = agentModelOptions[agentProvider].find(
    (option) => option.value === issueModel
  )
  const label = selectedOption?.label ?? defaultModelLabel(agentProvider)
  // Opening by pointer must leave focus exactly where it was. The composer
  // this picker sits in is usually the thing holding focus, and on a phone
  // taking it away closes the on-screen keyboard — which resizes the page out
  // from under the tap that opened the menu. A keyboard open still hands focus
  // to the menu, since arrowing through it is the only way to use it.
  const openedByPointerRef = useRef(false)
  // Radix composes `onOpenAutoFocus` ahead of the handler that focuses the
  // menu, and its FocusScope checks the same event, so preventing it leaves
  // focus untouched. The prop is real but deliberately absent from the public
  // menu types — a menu that never takes focus cannot be arrowed through, and
  // Radix would rather not offer that. Ours can still be: a keyboard open
  // focuses it as usual. The composer's focus test is the canary if an upgrade
  // ever drops the hook.
  const keepFocusWhereItIs: object = {
    onOpenAutoFocus: (event: Event) => {
      if (openedByPointerRef.current) {
        event.preventDefault()
      }
    },
  }

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
    <DropdownMenu modal={false} open={open} onOpenChange={onOpenChange}>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          disabled={disabled}
          aria-label="Choose agent and model"
          onPointerDown={() => {
            openedByPointerRef.current = true
          }}
          onKeyDown={() => {
            openedByPointerRef.current = false
          }}
          // Radix opens on pointerdown, so the tap can give up its default
          // action — moving focus to this button — without losing the menu.
          onMouseDown={(event) => event.preventDefault()}
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
      <DropdownMenuContent
        align="start"
        className="min-w-56"
        {...keepFocusWhereItIs}
        onCloseAutoFocus={(event) => {
          // Focus never left, so there is nothing to restore — and restoring
          // it to the trigger would close the keyboard on the way out.
          if (openedByPointerRef.current) {
            event.preventDefault()
          }
        }}
      >
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
