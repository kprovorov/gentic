# Gentic UI design-sync notes

## CRITICAL: never import "@tabler/icons-react" in preview .tsx files

Named imports from `@tabler/icons-react` (e.g. `import { IconHome } from
"@tabler/icons-react"`) inside a `.design-sync/previews/<Name>.tsx` file
cause `node .ds-sync/lib/preview-rebuild.mjs`'s esbuild invocation to enter
**runaway, unbounded memory growth** — observed hitting 14GB+ RSS before
being killed, climbing indefinitely (not a slow-but-finite build; a genuine
resource leak/pathological resolution loop). Reproduced independently across
three different component batches (Sidebar, DropdownMenu, Table) — every
preview file that imported this package triggered it; every one that didn't
built in well under a second. Root cause not diagnosed (suspect an
interaction between the custom `dsShim`/`ds-import-policy` esbuild plugins
in `lib/story-imports.mjs` and `@tabler/icons-react`'s ~12,000-file ESM
barrel under `dist/esm/`, possibly repeated `realpathSync` calls across a
pnpm symlink tree) — **do not attempt to fix by tuning esbuild options**,
just avoid the import.

The SAME icon imports are completely safe inside `packages/ui/src/**`
itself (bundled once via the main `package-build.mjs` entry, a different,
one-shot esbuild invocation with a different plugin chain) — this is
specifically about the targeted per-preview `preview-rebuild.mjs` path.

**Fix used throughout this sync**: define tiny inline SVG icon components
directly in the preview file instead:

```tsx
function svgIcon(path: string) {
  return function Icon(props: React.SVGProps<SVGSVGElement>) {
    return (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}
        strokeLinecap="round" strokeLinejoin="round" width={16} height={16} {...props}>
        <path d={path} />
      </svg>
    )
  }
}
const IconHome = svgIcon("M4 11 12 4l8 7v8a1 1 0 0 1-1 1h-4v-6H9v6H5a1 1 0 0 1-1-1v-8Z")
```

Needs `import * as React from "react"` at the top of the file for the
`React.SVGProps` type. See `.design-sync/previews/Sidebar.tsx` for a full
worked example (7 icons).

**Re-sync risk**: if a future preview author reaches for `@tabler/icons-react`
again (it's a real, listed dependency of `packages/ui`, so nothing stops
them), the same hang will recur. There's no config guard against this —
watch for it if a `preview-rebuild.mjs` invocation takes more than a few
seconds without a `✓ rebuilt` line, or if it shows via `ps` as a `node`
process with a live `esbuild --service` child consuming >500MB and rising.

## Build setup

`@gentic/ui` ships raw TSX with no build step (workspace-only package, consumed
via `@gentic/ui/<component>` subpath exports that point straight at `.tsx`).
There is no `.storybook/` and no `*.stories.*` files, so this repo syncs via
the **package shape** with a **synthesized entry** (no dist).

Command sequence to regenerate everything before running `package-build.mjs`
(also captured in `cfg.buildCmd`):

```sh
# 1. Real .d.ts contracts (see "Declaration build" below)
pnpm --filter @gentic/ui build:types

# 2. Compiled Tailwind CSS (see "Styling source" below)
node .ds-sync/compile-tailwind.mjs

# 3. Converter
node .ds-sync/package-build.mjs --config .design-sync/config.json \
  --node-modules ./packages/ui/node_modules \
  --entry ./packages/ui/dist/index.js \
  --out ./ds-bundle
```

`--entry ./packages/ui/dist/index.js` is deliberately a **path that doesn't
exist**. Passing it makes the converter walk up from `packages/ui/dist/` to
find `packages/ui/package.json` (so `PKG_DIR` resolves to `packages/ui`
directly, not through a workspace symlink under some app's `node_modules`)
without it being treated as a real dist entry — `resolveDistEntry` prints one
harmless `[NO_DIST] --entry ... doesn't exist` line, then falls through to
synth-entry from `src/`. Don't drop the `--entry` flag: without it, `PKG_DIR`
falls back to `<node-modules>/@gentic/ui`, which only exists as a workspace
symlink under `apps/web/node_modules` — using that path shifts `cfg.cssEntry`
/ `cfg.extraFonts` relative-path depth (see below).

`--node-modules ./packages/ui/node_modules` — packages/ui has its own
`node_modules` with `react`, `react-dom`, `@tabler/icons-react`, `radix-ui`,
etc. already resolvable there (pnpm per-package hoisting). No need to point
at the repo root or an app's node_modules.

## Declaration build (why `.d.ts` isn't generic)

Package-shape sync normally reads prop types from a package's **shipped**
`.d.ts` tree (`pkgJson.types`/`typings`). With no build, that tree doesn't
exist, and the converter's synth-entry mode does NOT populate the ts-morph
project it uses for prop extraction — every component's `<Name>.d.ts` came
out as the generic `{ [key: string]: unknown }` stub on the first pass.

Fix (additive, doesn't touch the package's real "exports"/consumption):

- `packages/ui/src/index.ts` — a barrel re-exporting every subpath module.
  New file, not wired into `package.json` "exports" (no `"."` key added, so
  it does not change how `apps/web` resolves `@gentic/ui/*` imports — those
  all go through the existing explicit subpath exports, confirmed no bare
  `from "@gentic/ui"` imports exist anywhere in the repo).
- `packages/ui/tsconfig.dts.json` (committed) — extends the real
  `packages/ui/tsconfig.json`, overrides `noEmit: false`,
  `declaration: true`, `emitDeclarationOnly: true`,
  `outDir: ".ds-cache/dist-types"`. Run via the new `build:types` script.
  Output is gitignored (`packages/ui/.ds-cache/`), regenerated every sync.
- `packages/ui/package.json` gained a `"build:types": "tsc -p tsconfig.dts.json"`
  script and `"types": ".ds-cache/dist-types/index.d.ts"`.
  Inert for real consumption (no `"."` in "exports", so bare-specifier
  resolution was already blocked either way) — it only feeds
  `findTypesRoot`/`loadDts` in the design-sync converter, which now parses
  30 real `.d.ts` files instead of 0, and every component gets its real
  prop interface (enums, `variant`/`size` unions, etc.) instead of the
  generic stub.

**Re-sync risk**: if `packages/ui/src/index.ts` or any component's public
props change, re-run step 1 above before the converter, or the `.d.ts`
contracts silently go stale (they're gitignored generated output, not
checked for staleness by anything except a rebuild).

## Styling source

`packages/ui` ships zero CSS of its own — Tailwind v4 (CSS-first, no JS
config) tokens and utility generation live entirely in
`apps/web/app/globals.css`, which `@source`s `packages/ui/src` so the real
compiled CSS only appears after Tailwind's JIT scans that directory.

`.ds-sync/compile-tailwind.mjs` runs `@tailwindcss/postcss` directly over
`apps/web/app/globals.css` (with `base: apps/web` so its own `@import`s of
`tailwindcss`, `tw-animate-css`, `shadcn/tailwind.css`, `streamdown/styles.css`
resolve) and writes the result to `packages/ui/.ds-cache/tailwind-compiled.css`
— **must** live inside `packages/ui/` because `cfg.cssEntry` is bounded to
the package root (security containment in `package-build.mjs`), not the
wider workspace.

`cfg.cssEntry` = `.ds-cache/tailwind-compiled.css` (relative to
`packages/ui/`).

**Re-sync risk**: if `apps/web/app/globals.css` tokens change (new CSS
variables, new `@theme` entries), or new utility classes get used inside
`packages/ui/src`, re-run `compile-tailwind.mjs` before the converter or the
shipped tokens/utilities go stale.

## Fonts

`apps/web/app/layout.tsx` loads brand fonts via `next/font/google`:
`Outfit` → `--font-heading`, `Inter` → `--font-sans`, `Geist_Mono` →
`--font-mono`. next/font self-hosts these at Next build time, so there is no
committed `@font-face` CSS anywhere in the repo to point `cfg.extraFonts` at
directly.

`.ds-sync/fetch-fonts.mjs` fetches the real families (latin subset only,
matching `subsets: ["latin"]` in layout.tsx) from the public Google Fonts
CSS2 API, downloads the actual woff2 files, and writes
`.design-sync/.cache/fonts/brand-fonts.css` with local `url()`s plus a
`:root` block mapping `--font-sans`/`--font-heading`/`--font-mono` to the
real family names (mirroring the `variable` option in layout.tsx — without
this mapping, `styles.css`'s `--font-sans: var(--font-sans)` from the Tailwind
compile is a dangling self-reference and text falls back to the UA default).

`cfg.extraFonts` = `["../../.design-sync/.cache/fonts/brand-fonts.css"]`
(workspace-root-bounded, not package-bounded, so this one's fine outside
`packages/ui/`).

**Re-sync risk**: if the brand fonts in `layout.tsx` ever change (different
family, different weights), re-run `fetch-fonts.mjs` (or update it) — it's
not part of the standard `buildCmd` chain since it rarely changes.

## CSS custom property names in authored previews

The compiled stylesheet (`packages/ui/.ds-cache/tailwind-compiled.css`, via
`apps/web/app/globals.css`'s `@theme inline` block) defines **bare** token
names only — `--primary`, `--primary-foreground`, `--muted`,
`--muted-foreground`, `--border`, etc. Tailwind v4's `@theme inline` mode
substitutes these directly into utility classes (`.bg-primary { background-color:
var(--primary) }`) rather than emitting a `--color-*`-prefixed intermediate
variable. **There is no `--color-primary`, `--color-muted`, etc. anywhere in
the shipped CSS.** An authored preview's inline `style={{ background:
"var(--color-primary)" }}` silently renders as transparent/nothing — no error,
just wrong. Found live in the first-pushed Message family batch (fixed
2026-07-24) — always prefer real Tailwind utility classNames (`bg-primary`,
`text-muted-foreground`, etc.) over inline `var(--*)` styles where a utility
exists; only reach for inline `var(--primary)` (bare name) when no utility
covers the case.

## Known limitations (accepted, not chased)

- **Toaster** (`sonner` wrapper) — its preview cannot show a real toast. The
  converter bundles `sonner` twice (once inside `_ds_bundle.js` via
  `@gentic/ui`'s `Toaster` export, once inside the preview's own
  `_preview/Toaster.js` from `import { toast } from "sonner"`), so `sonner`'s
  module-scope toast-state singleton is NOT shared between the two bundles —
  `toast()` calls from the preview never reach the mounted `<Toaster>`'s
  subscribers. This is a converter bundling limitation (sonner isn't
  deduped/externalized between the main bundle and preview bundles), not
  fixable from a preview `.tsx` alone. Toaster ships on the floor card
  (fully functional/importable, just no rich preview) until the converter
  externalizes `sonner` the same way it externalizes `react`/`react-dom`.

## Known render warns (accepted, not chased)

- `Checkbox`, `SidebarMenuSkeleton` — floor card renders under 5KB
  (`[RENDER_BLANK]`). Both are legitimately tiny/minimal-content components;
  not broken, just small. Will get real content once authored (in scope for
  this sync — "everything" preview scope).
- `ThemeProvider` — floor card renders 0px tall (`[RENDER_THIN]`). Expected:
  it's a non-visual context provider (next-themes wrapper), has no own
  layout. Its preview will need to render real children to show anything.
- `tokens: 1 missing` (below threshold, non-blocking) — not yet chased; spot
  check before final upload.

## Preview scope

User chose **"Everything (~131)"** — rich authored + graded previews for
every one of the 132 discovered exports, not just the ~28 top-level
families. Sub-parts that can't render standalone (e.g. `AlertDialogTrigger`,
`CardHeader`) get their preview `.tsx` written as the full parent
composition, per the skill's "compose context-required pieces inside their
parent" guidance — that's the only truthful render for a context-bound leaf.
