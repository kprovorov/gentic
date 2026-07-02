# Gentic

Gentic is a tool for managing coding agents. Teams can create coding issues,
assign them to an agent, and track the pull request created from the work.

## Tech stack

- Next.js
- Turborepo
- Supabase
- shadcn/ui

## Development

Install dependencies and start the workspace:

```bash
pnpm install
pnpm dev
```

The workspace is split into apps and packages:

- `apps/web` - Next.js application.
- `packages/ui` - shared UI components and UI utilities.
- `packages/supabase` - Supabase client, server, and middleware helpers.
- `packages/validators` - shared validation schemas.
- `packages/eslint-config`, `packages/typescript-config`, `packages/postcss-config` - shared tooling configuration.

Run checks before shipping changes:

```bash
pnpm lint
pnpm typecheck
```
