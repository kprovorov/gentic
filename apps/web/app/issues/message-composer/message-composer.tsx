"use client"

import type React from "react"
import { useEffect, useRef, useState, useSyncExternalStore } from "react"
import { createPortal } from "react-dom"
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
// selection across the switch — which is also why the modal treatment below
// raises the composer where it stands rather than moving it into a portal, and
// sends only its backdrop up to the body.
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

  // In use, so the composer takes over the screen: it opens and the page behind
  // it goes dim. The model menu opens in a portal, and sending disables — and
  // so blurs — the textarea; neither should drop the composer back down under
  // the user.
  const isRaised = isFocusWithin || isModelMenuOpen || isDragging || disabled
  // A parked attachment holds the open shape without the dimming, because the
  // user may well have left it there to go read the timeline.
  const isOpen = isRaised || draftFiles.length > 0

  const isSubmitDisabled = disabled || !draft.trim() || invalidSlashCommand

  function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    sentRef.current = !isSubmitDisabled
    onSubmit(event)
  }

  // Escape dismisses the raised composer the way it would any modal — unless
  // it is spent on something nearer first: the slash command menu, which
  // signals that by preventing the default, or the model menu, which keeps
  // focus here while it is open and so would otherwise be closed by the same
  // keypress that collapses the whole composer.
  function handleKeyDown(event: React.KeyboardEvent<HTMLTextAreaElement>) {
    onKeyDown?.(event)

    if (event.key === "Escape" && !event.defaultPrevented && !isModelMenuOpen) {
      event.currentTarget.blur()
    }
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
      className={cn("relative min-w-0", isRaised && "z-50", className)}
    >
      <ComposerBackdrop raised={Boolean(isRaised)} />

      {slashCommands.length > 0 ? (
        <SlashCommandMenu
          commands={slashCommands}
          selectedIndex={selectedSlashCommandIndex}
          onSelect={(command) => onSelectSlashCommand?.(command)}
        />
      ) : null}

      <div
        className={cn(
          "relative flex min-w-0 flex-wrap items-center gap-1 border border-transparent bg-input/50 p-1.5 transition-[border-radius,color,box-shadow,background-color]",
          isOpen ? "rounded-[22px]" : "rounded-full",
          // Over the backdrop the composer has to carry its own surface; the
          // translucent resting fill would just show the tint through.
          isRaised && "bg-popover shadow-2xl",
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
            onKeyDown={handleKeyDown}
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

// `body` is there from the first client render and never swapped, so the store
// never has to publish a change — it only keeps the server rendering nothing.
const subscribeToBody = () => () => {}
const getBody = () => document.body
const getServerBody = () => null

// The tint covers the whole window, global header included, so it has to be a
// child of nothing: rendered in place it inherits whatever the app shell does
// to its descendants, and a `fixed` element only fills the window while no
// ancestor has claimed it — an ancestor with a transform, a filter, or
// containment silently becomes the box it fills instead. From `body` there is
// no ancestor left to claim it. `z-40` ties the sticky header and wins on DOM
// order; the composer's own `z-50` keeps it above.
function ComposerBackdrop({ raised }: { raised: boolean }) {
  const container = useSyncExternalStore(
    subscribeToBody,
    getBody,
    getServerBody
  )

  if (!container) {
    return null
  }

  return createPortal(
    <div
      aria-hidden="true"
      data-slot="message-composer-backdrop"
      className={cn(
        "fixed inset-0 z-40 bg-black/35 transition-opacity duration-100",
        // Tinted, never blurred: the timeline stays legible behind the raised
        // composer, and the backdrop takes the click that dismisses it rather
        // than passing it through to the page.
        !raised && "pointer-events-none opacity-0"
      )}
    />,
    container
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
