"use client"

import type React from "react"

import { IconSend } from "@tabler/icons-react"

import { Button } from "@gentic/ui/button"
import { cn } from "@gentic/ui/utils"
import type { AgentProvider } from "@gentic/validators/issues"

import type { SlashCommand } from "../[code]/issue-chat/slash-commands"
import { AttachmentPromptField } from "../attachment-prompt-field"
import { AgentProviderPicker } from "./agent-provider-picker"

// Reusable across an existing issue's chat and a "new issue" composer:
// callers own all state (draft/files/agent) and pass callbacks in, so this
// component never assumes an issue with history already exists.
export function MessageComposer({
  draft,
  draftFiles,
  disabled,
  placeholder = "Message the agent…",
  invalidSlashCommand = false,
  slashCommands = [],
  selectedSlashCommandIndex = 0,
  onDraftChange,
  onFilesChange,
  onKeyDown,
  onSelectSlashCommand,
  onSubmit,
  agentProvider,
  hasMessages,
  onAgentProviderChange,
  agentPickerDisabled,
}: {
  draft: string
  draftFiles: File[]
  disabled?: boolean
  placeholder?: string
  invalidSlashCommand?: boolean
  slashCommands?: SlashCommand[]
  selectedSlashCommandIndex?: number
  onDraftChange: (value: string) => void
  onFilesChange: (files: File[]) => void
  onKeyDown?: (event: React.KeyboardEvent<HTMLTextAreaElement>) => void
  onSelectSlashCommand?: (command: SlashCommand) => void
  onSubmit: (event: React.FormEvent<HTMLFormElement>) => void
  agentProvider: AgentProvider
  hasMessages: boolean
  onAgentProviderChange: (
    provider: AgentProvider,
    info: { requiresReset: boolean }
  ) => void
  agentPickerDisabled?: boolean
}) {
  return (
    <form onSubmit={onSubmit} className="flex items-end gap-2">
      <div className="relative min-w-0 flex-1">
        {slashCommands.length > 0 ? (
          <SlashCommandMenu
            commands={slashCommands}
            selectedIndex={selectedSlashCommandIndex}
            onSelect={(command) => onSelectSlashCommand?.(command)}
          />
        ) : null}
        <AttachmentPromptField
          value={draft}
          onChange={onDraftChange}
          files={draftFiles}
          onFilesChange={onFilesChange}
          onKeyDown={onKeyDown}
          rows={2}
          placeholder={placeholder}
          disabled={disabled}
          className="min-w-0"
          textareaClassName="min-h-18 resize-none"
          footerEnd={
            <span className="ml-auto flex shrink-0 items-center gap-1 text-xs text-muted-foreground max-sm:hidden">
              <kbd className="rounded border border-border/60 bg-background px-1 font-mono">
                /
              </kbd>
              for commands
              <span aria-hidden="true">·</span>
              <kbd className="rounded border border-border/60 bg-background px-1 font-mono">
                ⌘↵
              </kbd>
              to send
            </span>
          }
        />
      </div>
      <div className="flex shrink-0 flex-col items-end gap-2">
        <AgentProviderPicker
          agentProvider={agentProvider}
          hasMessages={hasMessages}
          disabled={disabled || agentPickerDisabled}
          onAgentProviderChange={onAgentProviderChange}
        />
        <Button
          type="submit"
          size="icon"
          aria-label={disabled ? "Sending message" : "Send message to agent"}
          disabled={disabled || !draft.trim() || invalidSlashCommand}
        >
          <IconSend />
        </Button>
      </div>
    </form>
  )
}

function SlashCommandMenu({
  commands,
  selectedIndex,
  onSelect,
}: {
  commands: SlashCommand[]
  selectedIndex: number
  onSelect: (command: SlashCommand) => void
}) {
  return (
    <div className="absolute right-0 bottom-full left-0 z-20 mb-2 overflow-hidden rounded-xl border bg-popover text-popover-foreground shadow-lg">
      <div className="max-h-72 overflow-y-auto p-1">
        {commands.map((command, index) => (
          <button
            key={command.name}
            type="button"
            className={cn(
              "grid w-full grid-cols-[7.5rem_minmax(0,1fr)] items-center gap-3 rounded-lg px-3 py-2 text-left text-sm",
              index === selectedIndex
                ? "bg-accent text-accent-foreground"
                : "hover:bg-accent hover:text-accent-foreground"
            )}
            onMouseDown={(event) => {
              event.preventDefault()
              onSelect(command)
            }}
          >
            <span className="font-mono font-medium">{command.name}</span>
            <span className="truncate text-xs text-muted-foreground">
              {command.description}
            </span>
          </button>
        ))}
      </div>
    </div>
  )
}
