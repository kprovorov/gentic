// Shared look of the small pills that describe an issue — repository, agent,
// priority, and labels. The issue list rows, the issue detail header, and the
// create-issue composer all draw from these tokens, so a draft previews the
// row it is about to become.

/** Resting look of a badge: a neutral filled pill with a leading icon. */
export const issueBadgeClassName =
  "inline-flex h-6 shrink-0 items-center gap-1 rounded-full bg-muted px-2 text-xs font-medium text-muted-foreground"

/**
 * Added on top of a badge that is also a control. Badges are already filled,
 * so the affordance is a ring rather than a background change.
 */
export const interactiveIssueBadgeClassName =
  "transition-[color,box-shadow,background-color] hover:ring-2 hover:ring-ring/20 focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none disabled:pointer-events-none disabled:opacity-50 data-[state=open]:ring-2 data-[state=open]:ring-ring/30"

/**
 * Menu surface for a badge's dropdown. Opts out of the popover's default
 * translucent glass, which is too busy behind a dense list of options.
 */
export const issueBadgeMenuClassName = "rounded-lg bg-popover before:hidden"
