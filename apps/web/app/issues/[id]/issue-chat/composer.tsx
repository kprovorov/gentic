"use client"

import type React from "react"

import { IconSend } from "@tabler/icons-react"

import { Button } from "@gentic/ui/button"
import { cn } from "@gentic/ui/utils"

import { AttachmentPromptField } from "../../attachment-prompt-field"
import type { SlashCommand } from "./slash-commands"

export function IssueChatComposer({
  draft,
  draftKey,
  disabled,
  slashCommands,
  selectedSlashCommandIndex,
  onDraftChange,
  onFilesChange,
  onKeyDown,
  onSelectSlashCommand,
  onSubmit,
}: {
  draft: string
  draftKey: number
  disabled: boolean
  slashCommands: SlashCommand[]
  selectedSlashCommandIndex: number
  onDraftChange: (value: string) => void
  onFilesChange: (files: File[]) => void
  onKeyDown: (event: React.KeyboardEvent<HTMLTextAreaElement>) => void
  onSelectSlashCommand: (command: SlashCommand) => void
  onSubmit: (event: React.FormEvent<HTMLFormElement>) => void
}) {
  return (
    <form onSubmit={onSubmit} className="flex items-end gap-2">
      <div className="relative min-w-0 flex-1">
        {slashCommands.length > 0 ? (
          <SlashCommandMenu
            commands={slashCommands}
            selectedIndex={selectedSlashCommandIndex}
            onSelect={onSelectSlashCommand}
          />
        ) : null}
        <AttachmentPromptField
          key={draftKey}
          value={draft}
          onChange={onDraftChange}
          onFilesChange={onFilesChange}
          onKeyDown={onKeyDown}
          rows={2}
          placeholder="Message the agent…"
          disabled={disabled}
          className="min-w-0"
          textareaClassName="min-h-18 resize-none"
        />
      </div>
      <Button type="submit" size="icon" disabled={disabled || !draft.trim()}>
        <IconSend />
      </Button>
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
