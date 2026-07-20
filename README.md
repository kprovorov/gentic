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
pnpm test
pnpm build
```

The agent test suite includes race/reconnect coverage for prompt replay,
overlapping runs, final-message durability, ordering, and attachment scoping.
Run it under both UTC and a non-UTC timezone before changing chat or worker
behavior:

```bash
TZ=UTC pnpm --filter @gentic/gentic test
TZ=America/Los_Angeles pnpm --filter @gentic/gentic test
```

Pull request CI runs install, Supabase startup, generated database type checks,
database linting, lint, typecheck, root tests, agent tests in a non-UTC
timezone, and the production build. The Supabase checks use the local Docker
stack and do not require project secrets. To run them locally, install Docker,
then run:

```bash
pnpm dlx supabase@2.109.1 start
pnpm db:types:check
pnpm dlx supabase@2.109.1 db lint --local
```

Run the agent worker tests separately:

```bash
pnpm --filter @gentic/gentic test
```

## Supabase types

Database types are generated into `packages/supabase/src/database.types.ts`
from the local Supabase schema. Refresh them whenever a migration changes
tables, columns, functions, or relationships:

```bash
pnpm db:types
```

CI should verify the committed file is current:

```bash
pnpm db:types:check
```

Both commands use a pinned Supabase CLI (`pnpm dlx supabase@2.109.1 gen types
--lang=typescript --local --schema public`), so run them with the local
Supabase database started and migrations applied. Commit the generated diff
with the migration.

For worker installation, configuration, and service-management details, see
[`apps/gentic/readme.md`](apps/gentic/readme.md). Product documentation lives
in [`docs`](docs/README.md).
