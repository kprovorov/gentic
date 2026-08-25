"use client"

import Link from "next/link"
import { useLayoutEffect, useRef, useState, useSyncExternalStore } from "react"
import { useMutation, useQueryClient } from "@tanstack/react-query"
import {
  IconChevronDown,
  IconDotsVertical,
  IconPencil,
  IconRefresh,
  IconTrash,
} from "@tabler/icons-react"

import type { IssueDetailData, IssuePullRequest } from "@/app/queries"
import { updateIssueTitle } from "@/app/issues/actions"
import {
  AgentProviderBadge,
  IssuePriorityMenu,
  IssueStatusMenu,
  IssueTypeMenu,
  PullRequestPills,
  RepoBadge,
} from "@/app/issues/issues-columns"
import { getIssueEditHref } from "@/app/issues/urls"
import { queryKeys } from "@/app/query-keys"
import { SiteHeaderPortal } from "@/components/site-header-portal"
import { useKeyboardOpen } from "@/components/use-keyboard-open"
import { Button } from "@gentic/ui/button"
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@gentic/ui/collapsible"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@gentic/ui/dropdown-menu"
import { cn } from "@gentic/ui/utils"
import { isSpecIssueType } from "@gentic/validators/issues"
import type {
  ImplementationOwner,
  IssueRelation,
  IssueRelationIssue,
  ReviewCycle,
} from "@gentic/services/issues"
import type { LabelSnapshot } from "@gentic/validators/realtime"

import { IssueLabelChip } from "../issue-label-chip"
import type { Attachment } from "./attachments"
import { useIssueDelete } from "./issue-delete-button"
import { IssuePropertiesDialog } from "./issue-properties-dialog"
import { IssueRequestBody } from "./issue-request-body"
import { canResetIssue } from "./issue-reset-visibility"
import { useIssueReset } from "./use-issue-reset"

// Whether the details are folded away is a reading preference rather than
// something about one issue, so it is remembered across issues and reloads.
const HEADER_EXPANDED_STORAGE_KEY = "gentic:issue-detail-header-expanded:v1"

// `null` when the user has never toggled the header, which leaves the default.
function loadStoredHeaderExpanded(): boolean | null {
  try {
    const stored = window.localStorage.getItem(HEADER_EXPANDED_STORAGE_KEY)
    return stored === null ? null : stored === "true"
  } catch {
    return null
  }
}

function storeHeaderExpanded(expanded: boolean) {
  try {
    window.localStorage.setItem(HEADER_EXPANDED_STORAGE_KEY, String(expanded))
  } catch {
    return
  }
}

// Nothing outside this tab moves the preference mid-session, and the toggle
// that does keeps its own state, so there is nothing to subscribe to.
function subscribeToStoredHeaderExpanded() {
  return () => {}
}

function readHeaderExpandedOnServer() {
  return null
}

function resizeTitleTextarea(element: HTMLTextAreaElement | null) {
  if (!element) {
    return
  }

  element.style.height = "auto"
  element.style.height = `${element.scrollHeight}px`
}

function EditableIssueTitle({ issue }: { issue: IssueDetailData["issue"] }) {
  const queryClient = useQueryClient()
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const [isEditing, setIsEditing] = useState(false)
  const serverTitle = issue.title ?? ""
  const [titleState, setTitleState] = useState(() => ({
    draft: serverTitle,
    saved: serverTitle,
    server: serverTitle,
  }))
  let currentTitleState = titleState
  if (!isEditing && titleState.server !== serverTitle) {
    currentTitleState = {
      draft: serverTitle,
      saved: serverTitle,
      server: serverTitle,
    }
    setTitleState(currentTitleState)
  }
  const savedTitle = currentTitleState.saved

  useLayoutEffect(() => {
    if (!isEditing) {
      return
    }

    const textarea = textareaRef.current
    resizeTitleTextarea(textarea)
    textarea?.focus()
    textarea?.setSelectionRange(textarea.value.length, textarea.value.length)
  }, [isEditing])

  const mutation = useMutation({
    mutationFn: updateIssueTitle,
    onSuccess: async (updatedIssue) => {
      const nextTitle = updatedIssue.title ?? ""
      setTitleState((state) => ({
        ...state,
        draft: nextTitle,
        saved: nextTitle,
      }))
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: queryKeys.issue(issue.id) }),
        queryClient.invalidateQueries({
          queryKey: queryKeys.issueEdit(issue.id),
        }),
        queryClient.invalidateQueries({ queryKey: queryKeys.home }),
        queryClient.invalidateQueries({ queryKey: queryKeys.issues }),
      ])
    },
    onError: () => {
      setTitleState((state) => ({ ...state, draft: state.saved }))
    },
  })

  function finishEditing() {
    setIsEditing(false)

    const nextTitle = currentTitleState.draft.trim()
    if (!nextTitle) {
      setTitleState((state) => ({ ...state, draft: state.saved }))
      return
    }

    if (nextTitle === savedTitle || mutation.isPending) {
      setTitleState((state) => ({ ...state, draft: nextTitle }))
      return
    }

    setTitleState((state) => ({ ...state, draft: nextTitle }))
    const formData = new FormData()
    formData.set("id", issue.id)
    formData.set("title", nextTitle)
    mutation.mutate(formData)
  }

  const displayTitle = isEditing
    ? currentTitleState.draft || "Generating title..."
    : savedTitle || "Generating title..."

  if (isEditing) {
    return (
      <textarea
        ref={textareaRef}
        value={currentTitleState.draft}
        aria-label="Issue title"
        rows={1}
        maxLength={160}
        disabled={mutation.isPending}
        onBlur={finishEditing}
        onChange={(event) => {
          setTitleState((state) => ({
            ...state,
            draft: event.target.value,
          }))
          resizeTitleTextarea(event.currentTarget)
        }}
        onKeyDown={(event) => {
          if (event.key === "Enter" && !event.shiftKey) {
            event.preventDefault()
            event.currentTarget.blur()
            return
          }

          if (event.key === "Escape") {
            event.preventDefault()
            setTitleState((state) => ({ ...state, draft: state.saved }))
            setIsEditing(false)
          }
        }}
        className={cn(
          "block w-full resize-none overflow-hidden border-0 bg-transparent p-0 text-lg leading-tight font-semibold tracking-tight text-pretty break-words shadow-none ring-0 outline-none focus:border-0 focus:shadow-none focus:ring-0 focus:outline-none focus-visible:border-0 focus-visible:shadow-none focus-visible:ring-0 focus-visible:outline-none disabled:opacity-70",
          !currentTitleState.draft && "text-muted-foreground italic"
        )}
      />
    )
  }

  return (
    <button
      type="button"
      disabled={mutation.isPending}
      onClick={() => {
        setTitleState((state) => ({ ...state, draft: state.saved }))
        setIsEditing(true)
      }}
      className={cn(
        "block w-full cursor-text border-0 bg-transparent p-0 text-left text-lg leading-tight font-semibold tracking-tight break-words shadow-none ring-0 outline-none focus:border-0 focus:shadow-none focus:ring-0 focus:outline-none focus-visible:border-0 focus-visible:shadow-none focus-visible:ring-0 focus-visible:outline-none disabled:cursor-default disabled:opacity-70",
        !displayTitle && "text-muted-foreground italic"
      )}
    >
      {displayTitle}
    </button>
  )
}

export function IssueDetailHeader({
  issue,
  pullRequests,
  automaticPrPublishingInProgress,
  relations,
  relationCandidates,
  labels,
  attachments,
  messageAttachments,
  reviewCycles,
  implementationOwner,
}: {
  issue: IssueDetailData["issue"]
  pullRequests: IssuePullRequest[]
  automaticPrPublishingInProgress: boolean
  relations: IssueRelation[]
  relationCandidates: IssueRelationIssue[]
  labels: LabelSnapshot[]
  // The request below shows only what was attached to the issue itself; the
  // properties dialog carries the chat files too, since it stands in for the
  // rail's Files section below xl.
  attachments: Attachment[]
  messageAttachments: Attachment[]
  reviewCycles: ReviewCycle[]
  implementationOwner: ImplementationOwner | null
}) {
  const editHref = getIssueEditHref(issue) ?? "/issues"
  const { isPending, handleDelete } = useIssueDelete(issue.id)
  const { isPending: isResetPending, handleReset } = useIssueReset({
    issueId: issue.id,
    agentProvider: issue.agent_provider,
    issueModel: issue.issue_model,
  })
  // Title and status stay pinned; everything else about the issue — the
  // metadata pills and the request that kicked it off — collapses together so
  // the timeline can take the whole screen when the details aren't needed.
  //
  // The remembered preference can't seed a `useState`: this page is server
  // rendered, and a stored "collapsed" would contradict the expanded markup
  // being hydrated. Read it through the store hook instead, whose whole job is
  // that handover — hydration matches the server's `null`, then React re-runs
  // the render with what localStorage actually holds.
  const storedOpen = useSyncExternalStore(
    subscribeToStoredHeaderExpanded,
    loadStoredHeaderExpanded,
    readHeaderExpandedOnServer
  )
  const [openOverride, setOpenOverride] = useState<boolean | null>(null)
  const open = openOverride ?? storedOpen ?? true

  // Animate only what the user drives. The stored state arrives a render after
  // mount, and a header that folds shut on arrival reads as a flicker rather
  // than a transition.
  const [animated, setAnimated] = useState(false)

  function toggle(nextOpen: boolean) {
    setOpenOverride(nextOpen)
    setAnimated(true)
  }

  const isKeyboardOpen = useKeyboardOpen()
  const [keyboardWasOpen, setKeyboardWasOpen] = useState(isKeyboardOpen)

  // What is left of a phone screen under a keyboard cannot hold the details,
  // the timeline and the composer at once, and this header doesn't shrink — so
  // an expanded one pushes the composer clean off the bottom just as the user
  // goes to type in it. Fold it away when the keyboard arrives. Only on the
  // way in: reopening it from here is the user's call, keyboard or not. This
  // fold isn't stored either — it is the screen making room, not a preference,
  // and storing it would leave every issue collapsed after the first reply.
  if (isKeyboardOpen !== keyboardWasOpen) {
    setKeyboardWasOpen(isKeyboardOpen)

    if (isKeyboardOpen) {
      toggle(false)
    }
  }

  return (
    <Collapsible
      open={open}
      // Only a deliberate toggle is worth remembering, which is exactly what
      // Radix reports here — the keyboard fold above sets the state directly.
      onOpenChange={(nextOpen) => {
        toggle(nextOpen)
        storeHeaderExpanded(nextOpen)
      }}
      asChild
    >
      {/* The gap that separates the details from the title row lives inside the
          collapsible instead of on this column: a flex gap would survive the
          zero-height frame of the animation and make the header jump. */}
      <header className="flex min-w-0 flex-none flex-col px-6 py-4">
        <SiteHeaderPortal>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                variant="ghost"
                size="icon-sm"
                aria-label="Issue actions"
                className="shrink-0"
              >
                <IconDotsVertical />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem asChild>
                <Link href={editHref}>
                  <IconPencil />
                  Edit
                </Link>
              </DropdownMenuItem>
              {canResetIssue(issue) ? (
                <DropdownMenuItem
                  disabled={isResetPending}
                  // Unlike Delete this lets the menu close: the reset leaves
                  // the user on the issue, and a menu still hanging open over
                  // the freshly cleared transcript reads as a stuck click.
                  onSelect={handleReset}
                >
                  <IconRefresh />
                  Reset
                </DropdownMenuItem>
              ) : null}
              <DropdownMenuItem
                variant="destructive"
                disabled={isPending}
                onSelect={(event) => {
                  event.preventDefault()
                  handleDelete()
                }}
              >
                <IconTrash />
                Delete
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </SiteHeaderPortal>

        <div className="flex min-w-0 items-start gap-3">
          <IssueStatusMenu issue={issue} />

          <div className="min-w-0 flex-1">
            {/* Headings are `text-balance` globally, which wraps the title into
                short balanced lines; the detail title should use the full row. */}
            <h1 className="text-pretty">
              <EditableIssueTitle issue={issue} />
            </h1>
          </div>

          {/* The title itself is click-to-edit, so the toggle has to be its own
              control rather than the whole row. */}
          <CollapsibleTrigger asChild>
            <Button
              variant="ghost"
              size="icon-sm"
              aria-label={open ? "Hide issue details" : "Show issue details"}
              className="shrink-0 text-muted-foreground"
            >
              {/* Matches the collapse animation's duration so the arrow and the
                  panel settle together. */}
              <IconChevronDown
                className={cn(
                  animated && "transition-transform duration-200",
                  open && "rotate-180"
                )}
              />
            </Button>
          </CollapsibleTrigger>
        </div>

        {/* Radix publishes the measured height as a CSS variable, so the two
            keyframes slide between it and zero; padding stays on the inner
            column so the collapsed frame is truly empty. */}
        <CollapsibleContent
          className={cn(
            "overflow-hidden",
            animated &&
              "data-[state=closed]:animate-collapsible-up data-[state=open]:animate-collapsible-down motion-reduce:animate-none"
          )}
        >
          <div className="flex min-w-0 flex-col gap-3 pt-3">
            {/* The pills stand in for the rail on mobile, where it's hidden. The
                trailing "…" opens everything the rail would otherwise hold. */}
            <div className="flex flex-wrap items-center gap-1.5 xl:hidden">
              <IssueTypeMenu issue={issue} />
              {isSpecIssueType(issue.type) ? null : (
                <AgentProviderBadge provider={issue.agent_provider} />
              )}
              {issue.projects ? <RepoBadge repo={issue.projects.repo} /> : null}
              <PullRequestPills pullRequests={pullRequests} />
              <IssuePriorityMenu issue={issue} showLabel />
              {labels.map((label) => (
                <IssueLabelChip
                  key={label.id}
                  label={label}
                  className="text-xs"
                />
              ))}
              <IssuePropertiesDialog
                issue={issue}
                pullRequests={pullRequests}
                automaticPrPublishingInProgress={
                  automaticPrPublishingInProgress
                }
                relations={relations}
                relationCandidates={relationCandidates}
                labels={labels}
                attachments={attachments}
                messageAttachments={messageAttachments}
                reviewCycles={reviewCycles}
                implementationOwner={implementationOwner}
              />
            </div>

            {/* Capped so a long request can't eat the timeline and push the
                composer off the bottom of a viewport-height column. The cap
                tracks the *visible* height, so it keeps meaning what it says
                when a keyboard is covering a third of the screen. */}
            <div className="max-h-[calc(var(--visual-viewport-height,100dvh)*0.38)] min-w-0 overflow-y-auto">
              <IssueRequestBody body={issue.body} attachments={attachments} />
            </div>
          </div>
        </CollapsibleContent>
      </header>
    </Collapsible>
  )
}
