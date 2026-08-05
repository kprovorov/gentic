# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

Gentic manages coding agents: users create issues, assign them to an agent, and track the resulting pull request. It's a pnpm + Turborepo monorepo with two apps (`apps/web`, `apps/gentic`) and several shared packages.

## Commands

Run from the repo root; Turborepo fans out to every workspace:

```bash
pnpm install
pnpm dev         # runs all apps in watch mode
pnpm build
pnpm lint
pnpm typecheck
pnpm format
```

Scope to one workspace with `--filter`, e.g. `pnpm --filter @gentic/web dev` or `pnpm --filter @gentic/gentic build`.

- **Tests:** `apps/gentic`, `apps/web`, `packages/services`, and `packages/validators` each have a suite, using the **Node built-in test runner via tsx** (`node --import tsx --test ...`); `apps/web` additionally runs Vitest for `*.test.tsx` component tests. Run all of them with `pnpm test` (Turborepo fans out to every workspace with a `test` script). Run a single test with `--test-name-pattern`, e.g. `pnpm --filter @gentic/gentic test -- --test-name-pattern "name"`, or point at one file: `pnpm --filter @gentic/gentic exec node --import tsx --test src/config.test.ts`. `supabase/tests/*.sql` are pgTAP tests that run against a local Supabase instance (see below), not through `pnpm test`.
- **Local Supabase:** `supabase start` (config in `supabase/config.toml`). The `.mcp.json` Supabase MCP server points at `http://localhost:54321/mcp`.
- **Migrations** live in `supabase/migrations/` (timestamped SQL). Add new schema as a new migration file rather than editing old ones.

## Important: Next.js version

`apps/web` runs **Next.js 16**, which has breaking changes from older versions you may know (see `AGENTS.md`). Before writing App Router code, consult the bundled docs in `node_modules/next/dist/docs/`. Notably, the middleware file is **`apps/web/proxy.ts`** (exporting `proxy`), not `middleware.ts`.

## Architecture

### Apps

- **`apps/web`** (`@gentic/web`) — Next.js App Router UI, the agent REST API under `app/api/v1/agent/`, GitHub-App integration routes under `app/api/integrations/github/`, **and the remote MCP server** at `app/mcp/route.ts` (there is no longer a standalone MCP app). The MCP endpoint is built on `mcp-handler` + `@modelcontextprotocol/sdk` and accepts **two** bearer-token families, routed by prefix in `lib/mcp/token-verifier.ts`: Clerk OAuth tokens (`withMcpAuth` / `verifyClerkToken` from `@clerk/mcp-tools`) and worker credentials (`gtwc_...`, verified with `authenticateWorkerCredential`). Both resolve to the same Clerk `user_id` in `authInfo.extra.userId` and therefore the same account-wide tool registry; tool handlers live in `lib/mcp/handler.ts`. Uses Clerk for auth, TanStack Query, react-hook-form + Zod, shadcn/Radix UI.
- **`apps/gentic`** (`@gentic/gentic`) — the worker CLI. Polls the web app's agent API, atomically claims the highest-priority eligible issue with FIFO ordering within each priority, clones the repo, runs a coding agent over the **Agent Client Protocol** (`@agentclientprotocol/*`, Claude or Codex), streams messages/run-state back, and reports the PR URL. Entry: `src/cli.ts` → `src/commands/{run,auth,service,status,worker}.ts` → `src/worker.ts`. `gentic run` runs the worker in the foreground; `gentic start`/`gentic service` install it as a launchd/systemd service (`src/service/`). A worker connects with `gentic worker connect <code>` (`src/enrollment.ts`), exchanging a single-use enrollment code for a stable `GENTIC_WORKER_ID` + `GENTIC_WORKER_CREDENTIAL`, persisted to an OS-appropriate config file (`src/config-store.ts`) that survives restarts. Config merges that file with `.env`/environment variables, parsed by Zod in `src/config.ts` (`GENTIC_API_URL`, `GENTIC_WORKER_ID`, `GENTIC_WORKER_CREDENTIAL`, etc. — there is no `GENTIC_API_KEY` anymore, see below).

### Shared packages

- **`@gentic/supabase`** exposes three deliberately separate clients — pick by trust context:
  - `./client` — browser.
  - `./server` — Server Components / actions / route handlers; authenticates to Supabase's Data API with the **Clerk session token** so RLS runs as the user.
  - `./service` — Supabase secret key, **bypasses RLS**. Free of any `next` import so plain Node code (worker, MCP) can use it. Callers **must** authorize every query themselves.
- **`@gentic/services`** — business logic over Supabase, used by web pages/actions, the agent API, and the MCP handler. Subpath exports: `issues`, `projects`, `github-integrations`, `workers`, `errors`, `types`.
- **`@gentic/validators`** — shared Zod schemas (`auth`, `issues`, `projects`, `workers`, `agent`).
- **`@gentic/ui`** — shared shadcn/Radix components; each is a subpath export (e.g. `@gentic/ui/button`).
- `eslint-config`, `typescript-config`, `postcss-config` — shared tooling.

### Auth & data model (the key cross-cutting concern)

**Clerk is the identity provider; Supabase is the database.** Clerk session tokens are passed to Supabase so RLS policies see the Clerk user. `user_id` columns store **Clerk user ids** (`user_...` strings) — early migrations referenced `auth.users`/`auth.uid()` but a later migration moved ownership to Clerk. Enable the Supabase integration in the Clerk dashboard so tokens carry `role: authenticated`.

Two distinct authorization paths, because secret-key code bypasses RLS:
- **User-facing** (web pages/actions): use the `./server` client and let RLS enforce ownership.
- **Trusted server code** (agent API in `app/api/v1/agent/`, MCP handler in `lib/mcp/`): use the `./service` client and authorize manually via helpers like `ensureIssueOwned` / `ensureProjectOwned` (in `@gentic/services/issues`), which check ownership through the `issues → projects.user_id` join (the `issues` table has no `user_id` of its own).

The same worker credential also authenticates the **remote MCP server** at `app/mcp/route.ts`, so a managed coding-agent session reaches its owner's issue tracker without any per-worker OAuth dance; `apps/gentic/src/mcp.ts` injects that authenticated HTTP MCP server into every fresh and resumed Claude Code and Codex session.

The **agent API** authenticates with a **worker-specific credential** (`Authorization: Bearer gtwc_...`), not a Clerk API key — that shared-key model is gone (an intentional alpha breaking change; see below). `authenticateWorkerCredential` (`@gentic/services/workers`) looks up the SHA-256 hash of the bearer token directly against `workers.credential_hash` (globally unique) and returns the owning Clerk `user_id` plus ban state; no Clerk call or cache tier is involved. See `apps/web/app/api/v1/agent/_lib.ts`.

### Connected worker management

Each worker is a row in `public.workers`, obtained by exchanging a single-use, 10-minute enrollment code (`gentic worker connect <code>`, generated from the web Settings page) for a stable worker id and credential — there is no shared key and no automatic backfill of a prior single-worker setup. Workers report heartbeats every 30s (`last_seen_at`) and are considered `online` for `WORKER_OFFLINE_AFTER_MS` (90s) after the last one; the Settings UI polls every 15s. A worker also polls a lightweight control endpoint every 10s to learn if it's been banned, so a banned worker's process self-terminates within ~10s. Banning or deleting a worker (`ban_worker`/`delete_worker` RPCs) atomically requeues its active, non-terminal issues back to `todo`; deleting additionally force-expires the credential immediately. A separate `pg_cron` job (`reconcile_offline_worker_runs`, every 30s) fails — but does **not** requeue — runs whose worker has gone silent for 5 minutes, so a crashed/partitioned worker's issues surface as `run-failed` for manual retry rather than looping forever. See `packages/services/src/workers.ts`, `supabase/migrations/20260729*_*worker*.sql`, and `docs/web/connected-workers.mdx`.

## Agent skills

### Issue tracker

Issues live in the Gentic app itself (project "Gentic", `kprovorov/gentic`), managed via the `mcp__gentic__*` MCP tools — this repo dogfoods its own product. See `docs/agents/issue-tracker.md`.

### Triage labels

Gentic has no native labels; the five canonical triage roles map to its `status` field plus a title-prefix convention. See `docs/agents/triage-labels.md`.

### Domain docs

Single-context: one `CONTEXT.md` + `docs/adr/` at the repo root. See `docs/agents/domain.md`.

## Conventions

- Prettier: **no semicolons**, double quotes, 2-space, `printWidth` 80, `trailingComma: es5`. Tailwind classes are auto-sorted; `cn`/`cva` are registered Tailwind functions.
- ESLint 9 flat config from `@gentic/eslint-config` (`/base` for libs, `/next` for web).
- Zod version is pinned via a pnpm `overrides` entry (`zod: 4.4.3`) — keep imports on that major.
- **Pull request titles** must follow [Conventional Commits](https://www.conventionalcommits.org/): prefix every PR title with a type such as `feat:`, `fix:`, `chore:`, `docs:`, `refactor:`, `test:`, `perf:`, `build:`, or `ci:` (e.g. `feat: add issue assignment API`). PRs are squash-merged, so the title becomes the commit message that CI/CD and release tooling parse — an unprefixed title breaks that pipeline.
- **Pull request status:** when an agent opens a PR, it must be ready for review. Do not create draft PRs.
