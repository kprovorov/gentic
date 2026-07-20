# Gentic

Gentic is a tool for managing coding agents. Teams can create coding issues,
assign them to an agent, and track the pull request created from the work.

## Tech stack

- Next.js
- Turborepo
- Clerk
- Supabase
- shadcn/ui

## Development

This repository uses Node.js 20+, pnpm 11.9.0, and Turborepo. Install
dependencies and start the workspace:

```bash
pnpm install
pnpm dev
```

The workspace is split into apps and packages:

- `apps/web` - Next.js application.
- `apps/gentic` - agent worker CLI and native service manager.
- `packages/ui` - shared UI components and UI utilities.
- `packages/services` - shared project and issue data-access logic.
- `packages/supabase` - Supabase client, server, and middleware helpers.
- `packages/validators` - shared validation schemas.
- `packages/eslint-config`, `packages/typescript-config`, `packages/postcss-config` - shared tooling configuration.
- `supabase` - local Supabase configuration and database migrations.
- `docs` - Mintlify product documentation.

Run checks before shipping changes:

```bash
pnpm lint
pnpm typecheck
pnpm build
```

Run the agent worker tests separately:

```bash
pnpm --filter @gentic/gentic test
```

For worker installation, configuration, and service-management details, see
[`apps/gentic/readme.md`](apps/gentic/readme.md). Product documentation lives
in [`docs`](docs/README.md).
