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
  formRef,
  action,
  encType,
  formId,
  className,
  fieldClassName,
  textareaClassName,
  id,
  name,
  required,
  rows = 2,
  draft,
  draftFiles,
  disabled,
  placeholder = "Message the agent…",
  submitDisabled,
  submitAriaLabel,
  showCommandHint = true,
  invalidSlashCommand = false,
  slashCommands = [],
  selectedSlashCommandIndex = 0,
  children,
  onDraftChange,
  onFilesChange,
  onKeyDown,
  onSelectSlashCommand,
  onSubmit,
  onInvalidCapture,
  agentProvider,
  hasMessages,
  onAgentProviderChange,
  agentPickerDisabled,
  footerStart,
  footerEnd,
  submitButton,
}: {
  formRef?: React.Ref<HTMLFormElement>
  action?: React.ComponentProps<"form">["action"]
  encType?: React.ComponentProps<"form">["encType"]
  formId?: string
  className?: string
  fieldClassName?: string
  textareaClassName?: string
  id?: string
  name?: string
  required?: boolean
  rows?: number
  draft: string
  draftFiles: File[]
  disabled?: boolean
  placeholder?: string
  submitDisabled?: boolean
  submitAriaLabel?: string
  showCommandHint?: boolean
  invalidSlashCommand?: boolean
  slashCommands?: SlashCommand[]
  selectedSlashCommandIndex?: number
  children?: React.ReactNode
  onDraftChange: (value: string) => void
  onFilesChange: (files: File[]) => void
  onKeyDown?: (event: React.KeyboardEvent<HTMLTextAreaElement>) => void
  onSelectSlashCommand?: (command: SlashCommand) => void
  onSubmit: (event: React.FormEvent<HTMLFormElement>) => void
  onInvalidCapture?: React.FormEventHandler<HTMLFormElement>
  agentProvider: AgentProvider
  hasMessages: boolean
  onAgentProviderChange: (
    provider: AgentProvider,
    info: { requiresReset: boolean }
  ) => void
  agentPickerDisabled?: boolean
  footerStart?: React.ReactNode
  footerEnd?: React.ReactNode
  submitButton?: React.ReactNode
}) {
  const isSubmitDisabled =
    submitDisabled ?? (disabled || !draft.trim() || invalidSlashCommand)

  return (
    <form
      ref={formRef}
      action={action}
      encType={encType}
      id={formId}
      onSubmit={onSubmit}
      onInvalidCapture={onInvalidCapture}
      className={cn(
        "flex min-w-0 flex-col gap-2.5 sm:flex-row sm:items-end",
        className
      )}
    >
      {children}
      <div className="relative min-w-0 flex-1">
        {slashCommands.length > 0 ? (
          <SlashCommandMenu
            commands={slashCommands}
            selectedIndex={selectedSlashCommandIndex}
            onSelect={(command) => onSelectSlashCommand?.(command)}
          />
        ) : null}
        {showCommandHint ? (
          <span className="pointer-events-none absolute top-2.5 right-3.5 z-10 flex items-center gap-1 text-[11px] text-muted-foreground/70 max-sm:hidden">
            <kbd className="rounded bg-background px-1 font-mono text-[10.5px] ring-1 ring-border">
              /
            </kbd>
            for commands
            <span aria-hidden="true">·</span>
            <kbd className="rounded bg-background px-1 font-mono text-[10.5px] ring-1 ring-border">
              ⌘↵
            </kbd>
            to send
          </span>
        ) : null}
        <AttachmentPromptField
          id={id}
          name={name}
          value={draft}
          onChange={onDraftChange}
          files={draftFiles}
          onFilesChange={onFilesChange}
          onKeyDown={onKeyDown}
          rows={rows}
          placeholder={placeholder}
          required={required}
          disabled={disabled}
          className={cn("min-w-0", fieldClassName)}
          textareaClassName={cn("min-h-16 resize-none", textareaClassName)}
          footerStart={
            <>
              <AgentProviderPicker
                agentProvider={agentProvider}
                hasMessages={hasMessages}
                disabled={disabled || agentPickerDisabled}
                onAgentProviderChange={onAgentProviderChange}
              />
              {footerStart}
            </>
          }
          footerEnd={footerEnd}
        />
      </div>
      {submitButton ?? (
        <Button
          type="submit"
          size="icon"
          aria-label={
            submitAriaLabel ??
            (disabled ? "Sending message" : "Send message to agent")
          }
          disabled={isSubmitDisabled}
          className="shrink-0"
        >
          <IconSend />
        </Button>
      )}
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
