## Working with @gentic/ui

This is a shadcn/Radix-based component library styled entirely with Tailwind
v4 utility classes — there are no CSS-in-JS props and no separate theme
object. Build with real components, real utility classes, real tokens.

### Styling idiom: Tailwind utilities over bare CSS custom properties

Every component styles itself with Tailwind utility classes that resolve to
this library's own design tokens. Reach for these families first instead of
inventing hex colors or spacing:

| Family | Real classes |
|---|---|
| Surface | `bg-background`, `bg-card`, `bg-popover`, `bg-muted`, `bg-input` |
| Text | `text-foreground`, `text-muted-foreground`, `text-card-foreground` |
| Brand | `bg-primary` / `text-primary-foreground`, `bg-secondary` / `text-secondary-foreground` |
| Status | `bg-destructive`, `text-destructive` |
| Border | `border-border`, `border-input`, `border-ring` |
| Radius | `rounded-4xl` (pills — buttons, badges), `rounded-3xl`, `rounded-lg` |
| Type | `font-sans` (body, Inter), `font-heading` (headings, Outfit), `font-mono` (code, Geist Mono) |

If you ever need a raw CSS variable instead of a utility class (rare — e.g.
an inline `style` on a non-Tailwind element), the **bare** token names are
what's shipped: `var(--primary)`, `var(--muted)`, `var(--border)`, etc. —
**not** `var(--color-primary)` or any `--color-*`-prefixed name. This
library's Tailwind setup uses `@theme inline` mode, which substitutes the
bare token directly into utilities rather than emitting a `--color-*` alias,
so `--color-*` names simply don't exist in the shipped CSS.

Dark mode is a `.dark` class on an ancestor element (typically `<html>`) —
every token above already has a dark-mode override baked into `styles.css`,
so components need no dark-mode-specific classes of their own.

### Providers components expect

A few components read from React context and render incorrectly (or throw)
without their provider ancestor — always wrap:

- **Tooltip** family (`Tooltip`, `TooltipContent`, `TooltipTrigger`, and any
  `SidebarMenuButton` using its `tooltip` prop) need a `<TooltipProvider>`
  ancestor.
- **Sidebar** family needs `<SidebarProvider>` wrapping `<Sidebar>` +
  `<SidebarInset>`.
- **MessageScroller** family needs `<MessageScrollerProvider>` wrapping the
  scroll area.
- **Form** family (`Form`, `FormField`, etc.) is react-hook-form's
  `FormProvider` under the hood — pass a real `useForm()` instance's
  `control`/spread props, not static markup.
- **ThemeProvider** (a `next-themes` wrapper) only matters if you need
  runtime light/dark switching — for a static design it's optional; apply
  `.dark` directly to an ancestor instead when you just need the dark
  palette.

### Where the truth lives

Read the bound copies before styling or composing:
- `styles.css` — the entry point; `@import`s the actual compiled
  `_ds_bundle.css` (every component's real utility CSS) and `fonts/fonts.css`.
- `components/<group>/<Name>/<Name>.d.ts` — the real prop contract (enums
  like `variant`/`size` are fully expanded, not just `string`).
- `components/<group>/<Name>/<Name>.prompt.md` — per-component usage notes.

### A real composition

```tsx
import { Card, CardHeader, CardTitle, CardDescription, CardContent, CardFooter, Button } from "@gentic/ui"

function IssueCard() {
  return (
    <Card style={{ maxWidth: 360 }}>
      <CardHeader>
        <CardTitle>Fix login redirect bug</CardTitle>
        <CardDescription>gentic/web · opened 2 days ago</CardDescription>
      </CardHeader>
      <CardContent>
        <p>Users are redirected to the wrong page after signing in with an expired session.</p>
      </CardContent>
      <CardFooter style={{ gap: 8 }}>
        <Button size="sm">Assign agent</Button>
        <Button size="sm" variant="outline">View issue</Button>
      </CardFooter>
    </Card>
  )
}
```
