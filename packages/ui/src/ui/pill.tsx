import * as React from "react"
import { cva, type VariantProps } from "class-variance-authority"
import { Slot } from "radix-ui"

import { cn } from "../utils"

/**
 * The xs secondary button, reused as the app's single metadata pill. Labels,
 * priority, repository, model, selection, pull requests, issue type, and issue
 * status all render through this so they share one height, radius, and
 * palette. Geometry mirrors `buttonVariants` deliberately — the hover, focus,
 * and press affordances are split out under `interactive` so a static pill
 * doesn't look clickable.
 */
const pillVariants = cva(
  "group/pill inline-flex max-w-full min-w-0 shrink-0 items-center justify-center rounded-4xl border border-transparent bg-clip-padding font-medium whitespace-nowrap transition-all outline-none select-none [&_svg]:pointer-events-none [&_svg]:shrink-0",
  {
    variants: {
      variant: {
        secondary: "bg-secondary text-secondary-foreground",
        outline: "border-border bg-background text-foreground",
        ghost: "text-muted-foreground",
      },
      size: {
        xs: "h-6 gap-1 px-2.5 text-xs [&_svg:not([class*='size-'])]:size-3.5",
        sm: "h-8 gap-1.5 px-2.5 text-xs [&_svg:not([class*='size-'])]:size-3.5",
        default:
          "h-9 gap-2.5 px-3 text-[13px] [&_svg:not([class*='size-'])]:size-[15px]",
        "icon-xs": "size-6 text-xs [&_svg:not([class*='size-'])]:size-3.5",
        "icon-sm": "size-8 text-xs [&_svg:not([class*='size-'])]:size-4",
      },
      // Radix triggers set aria-expanded, so an open menu keeps its pill ringed
      // for as long as the menu is on screen.
      interactive: {
        true: "cursor-pointer focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/30 active:not-aria-[haspopup]:translate-y-px disabled:pointer-events-none disabled:opacity-50 aria-expanded:ring-3 aria-expanded:ring-ring/20 aria-invalid:border-destructive aria-invalid:ring-3 aria-invalid:ring-destructive/20",
        false: "",
      },
      selected: {
        true: "ring-2 ring-ring/40",
        false: "",
      },
    },
    compoundVariants: [
      {
        variant: "secondary",
        interactive: true,
        class:
          "hover:bg-[color-mix(in_oklch,var(--secondary),var(--foreground)_5%)]",
      },
      {
        variant: "outline",
        interactive: true,
        class: "hover:bg-muted dark:hover:bg-input/30",
      },
      {
        variant: "ghost",
        interactive: true,
        class: "hover:bg-muted hover:text-foreground dark:hover:bg-muted/50",
      },
    ],
    defaultVariants: {
      variant: "secondary",
      size: "xs",
      interactive: false,
      selected: false,
    },
  }
)

type PillVariants = VariantProps<typeof pillVariants>

/** A read-only pill. Renders a span, so it nests anywhere text does. */
function Pill({
  className,
  variant = "secondary",
  size = "xs",
  interactive = false,
  selected = false,
  asChild = false,
  ...props
}: React.ComponentProps<"span"> & PillVariants & { asChild?: boolean }) {
  const Comp = asChild ? Slot.Root : "span"

  return (
    <Comp
      data-slot="pill"
      data-variant={variant}
      data-size={size}
      className={cn(
        pillVariants({ variant, size, interactive, selected, className })
      )}
      {...props}
    />
  )
}

/**
 * The clickable pill: menu triggers, filter chips, and pull request links.
 * Pass `asChild` to render it as a `Link` instead of a `button`.
 */
function PillButton({
  className,
  variant = "secondary",
  size = "xs",
  interactive = true,
  selected = false,
  asChild = false,
  type,
  ...props
}: React.ComponentProps<"button"> & PillVariants & { asChild?: boolean }) {
  const Comp = asChild ? Slot.Root : "button"

  return (
    <Comp
      data-slot="pill"
      data-variant={variant}
      data-size={size}
      type={asChild ? type : (type ?? "button")}
      className={cn(
        pillVariants({ variant, size, interactive, selected, className })
      )}
      {...props}
    />
  )
}

/** Pill text that truncates rather than stretching the pill past its row. */
function PillLabel({ className, ...props }: React.ComponentProps<"span">) {
  return (
    <span
      data-slot="pill-label"
      className={cn("min-w-0 truncate", className)}
      {...props}
    />
  )
}

export { Pill, PillButton, PillLabel, pillVariants }
