"use client"

import type React from "react"
import { useEffect, useRef, useState } from "react"
import { IconLoader2, IconPaperclip, IconSend } from "@tabler/icons-react"

import { Button } from "@gentic/ui/button"
import { cn } from "@gentic/ui/utils"
import type { AgentProvider } from "@gentic/validators/issues"

import type { SlashCommand } from "../[code]/issue-chat/slash-commands"
import {
  PendingAttachmentChip,
  useAttachmentSelection,
} from "../attachment-selection"
import { AgentModelPicker } from "./agent-model-picker"

// Two shapes, one DOM tree: at rest the composer is a single pill row — attach,
// the draft truncated to one line, send — so the timeline keeps the vertical
// space, and it opens into a box (textarea on its own line, attach + model
// picker + send underneath) while it is in use. The shapes differ only in
// Tailwind classes, never in structure, so the textarea keeps its focus and
// selection across the switch.
export function MessageComposer({
  className,
  draft,
  draftFiles,
  disabled,
  placeholder = "Follow up…",
  invalidSlashCommand = false,
  slashCommands = [],
  selectedSlashCommandIndex = 0,
  onDraftChange,
  onFilesChange,
  onKeyDown,
  onSelectSlashCommand,
  onSubmit,
  agentProvider,
  issueModel,
  hasMessages,
  onAgentModelChange,
  pickerDisabled,
}: {
  className?: string
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
  issueModel: string | null
  hasMessages: boolean
  onAgentModelChange: (
    agentProvider: AgentProvider,
    issueModel: string | null,
    info: { requiresReset: boolean }
  ) => void
  pickerDisabled?: boolean
}) {
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const sentRef = useRef(false)
  const [isFocusWithin, setIsFocusWithin] = useState(false)
  const [isModelMenuOpen, setIsModelMenuOpen] = useState(false)
  const {
    isDragging,
    removeFile,
    openFilePicker,
    fileInputProps,
    dropTargetProps,
  } = useAttachmentSelection({ files: draftFiles, onFilesChange })

  // The model menu opens in a portal, and sending disables — and so blurs —
  // the textarea; neither should snap the composer shut under the user.
  const isOpen =
    isFocusWithin ||
    isModelMenuOpen ||
    isDragging ||
    disabled ||
    draftFiles.length > 0

  const isSubmitDisabled = disabled || !draft.trim() || invalidSlashCommand

  function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    sentRef.current = !isSubmitDisabled
    onSubmit(event)
  }

  // Sending takes focus off the disabled textarea, so hand it back once the
  // message is on its way: the composer stays open for the follow-up instead
  // of collapsing after every send.
  useEffect(() => {
    if (disabled || !sentRef.current) {
      return
    }

    sentRef.current = false
    textareaRef.current?.focus()
  }, [disabled])

  // Grow the open composer with the draft, up to the max height its own class
  // caps it at. The collapsed row is always one line, so it keeps the height
  // its class gives it.
  useEffect(() => {
    const textarea = textareaRef.current
    if (!textarea) {
      return
    }

    if (!isOpen) {
      textarea.style.height = ""
      return
    }

    textarea.style.height = "auto"
    textarea.style.height = `${textarea.scrollHeight}px`
  }, [draft, isOpen])

  return (
    <form
      onSubmit={handleSubmit}
      onFocus={() => setIsFocusWithin(true)}
      onBlur={(event) => {
        const nextTarget = event.relatedTarget
        if (
          !(nextTarget instanceof Node) ||
          !event.currentTarget.contains(nextTarget)
        ) {
          setIsFocusWithin(false)
        }
      }}
      className={cn("relative min-w-0", className)}
    >
      {slashCommands.length > 0 ? (
        <SlashCommandMenu
          commands={slashCommands}
          selectedIndex={selectedSlashCommandIndex}
          onSelect={(command) => onSelectSlashCommand?.(command)}
        />
      ) : null}

      <div
        className={cn(
          "flex min-w-0 flex-wrap items-center gap-1 border border-transparent bg-input/50 p-1.5 transition-[border-radius,color,box-shadow,background-color]",
          isOpen ? "rounded-[22px]" : "rounded-full",
          (isFocusWithin || isDragging) && "border-ring ring-3 ring-ring/30"
        )}
        {...dropTargetProps}
      >
        <input {...fileInputProps} />

        <div
          className={cn(
            "relative min-w-0",
            isOpen ? "order-1 w-full px-2.5 pt-1" : "order-2 flex-1 px-1"
          )}
        >
          <textarea
            ref={textareaRef}
            value={draft}
            onChange={(event) => onDraftChange(event.target.value)}
            onKeyDown={onKeyDown}
            rows={1}
            placeholder={placeholder}
            disabled={disabled}
            aria-label="Message the agent"
            className={cn(
              "w-full resize-none bg-transparent py-1 text-base leading-6 outline-none placeholder:text-muted-foreground disabled:pointer-events-none disabled:opacity-50 md:text-sm",
              isOpen ? "max-h-56 min-h-12" : "h-8 overflow-hidden",
              // The one-line draft below carries the ellipsis a textarea can't.
              !isOpen && draft && "text-transparent"
            )}
          />
          {!isOpen && draft ? (
            <span
              aria-hidden="true"
              className="pointer-events-none absolute inset-0 truncate py-1 text-base leading-6 md:text-sm"
            >
              {draft}
            </span>
          ) : null}
        </div>

        {draftFiles.length > 0 ? (
          <ul className="order-2 flex w-full min-w-0 flex-wrap gap-2 px-1.5 pb-1">
            {draftFiles.map((file, index) => (
              <li
                key={`${file.name}-${file.size}-${file.lastModified}`}
                className="flex max-w-full min-w-0"
              >
                <PendingAttachmentChip
                  file={file}
                  disabled={disabled}
                  onRemove={() => removeFile(index)}
                />
              </li>
            ))}
          </ul>
        ) : null}

        {/* Attach and send sit on both rows, so a click that also moved focus
            would reshape the composer mid-click and land the mouseup somewhere
            else; keeping focus put makes the button stay under the pointer. */}
        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          disabled={disabled}
          onMouseDown={(event) => event.preventDefault()}
          onClick={() => openFilePicker()}
          aria-label="Attach files"
          className={cn(
            "rounded-full text-muted-foreground hover:bg-muted hover:text-foreground",
            isOpen ? "order-3" : "order-1"
          )}
        >
          <IconPaperclip />
        </Button>

        {isOpen ? (
          <AgentModelPicker
            agentProvider={agentProvider}
            issueModel={issueModel}
            hasMessages={hasMessages}
            disabled={disabled || pickerDisabled}
            onAgentModelChange={onAgentModelChange}
            open={isModelMenuOpen}
            onOpenChange={setIsModelMenuOpen}
            className="order-4"
          />
        ) : null}

        <span
          aria-hidden="true"
          className={cn("min-w-0 flex-1", isOpen ? "order-5" : "hidden")}
        />

        <Button
          type="submit"
          size="icon-sm"
          aria-label={disabled ? "Sending message" : "Send message to agent"}
          disabled={isSubmitDisabled}
          onMouseDown={(event) => event.preventDefault()}
          className={cn("rounded-full", isOpen ? "order-6" : "order-3")}
        >
          {disabled ? <IconLoader2 className="animate-spin" /> : <IconSend />}
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
