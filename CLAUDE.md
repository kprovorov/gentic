# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

Gentic manages coding agents: users create issues, assign them to an agent, and track the resulting pull request. It's a pnpm + Turborepo monorepo with three apps and several shared packages.

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

- **Tests:** only `apps/mcp` has a suite (`pnpm --filter @gentic/mcp test`, Jest). Run a single test with `pnpm --filter @gentic/mcp test -- -t "name"`.
- **Local Supabase:** `supabase start` (config in `supabase/config.toml`). The `.mcp.json` Supabase MCP server points at `http://localhost:54321/mcp`.
- **Migrations** live in `supabase/migrations/` (timestamped SQL). Add new schema as a new migration file rather than editing old ones.

## Important: Next.js version

`apps/web` runs **Next.js 16**, which has breaking changes from older versions you may know (see `AGENTS.md`). Before writing App Router code, consult the bundled docs in `node_modules/next/dist/docs/`. Notably, the middleware file is **`apps/web/proxy.ts`** (exporting `proxy`), not `middleware.ts`.

## Architecture

### Apps

- **`apps/web`** (`@gentic/web`) — Next.js App Router UI plus the agent REST API under `app/api/v1/agent/`. Uses Clerk for auth, TanStack Query, react-hook-form + Zod, shadcn/Radix UI.
- **`apps/gentic`** (`@gentic/gentic`) — the worker CLI (`gentic run`). Polls the web app's agent API, atomically claims the oldest queued issue, clones the repo, runs a coding agent over the **Agent Client Protocol** (`@agentclientprotocol/*`, Claude or Codex), streams messages/run-state back, and reports the PR URL. Entry: `src/cli.ts` → `src/commands/run.ts` → `src/worker.ts`. Config is env-only, parsed by Zod in `src/config.ts` (`GENTIC_API_URL`, `GENTIC_API_KEY`, etc.).
- **`apps/mcp`** (`@gentic/mcp`) — remote MCP server (Express 5 + Clerk OAuth via `@clerk/mcp-tools`). Built with **tsdown to CommonJS** (`dist/index.cjs`) and deployed on Vercel; it skips `app.listen` when `process.env.VERCEL` is set.

### Shared packages

- **`@gentic/supabase`** exposes three deliberately separate clients — pick by trust context:
  - `./client` — browser.
  - `./server` — Server Components / actions / route handlers; authenticates to Supabase's Data API with the **Clerk session token** so RLS runs as the user.
  - `./service` — Supabase secret key, **bypasses RLS**. Free of any `next` import so plain Node code (worker, MCP) can use it. Callers **must** authorize every query themselves.
- **`@gentic/services`** — business logic over Supabase (`issues`, `projects`), used by both web and MCP.
- **`@gentic/validators`** — shared Zod schemas (`auth`, `issues`, `projects`).
- **`@gentic/ui`** — shared shadcn/Radix components; each is a subpath export (e.g. `@gentic/ui/button`).
- `eslint-config`, `typescript-config`, `postcss-config` — shared tooling.

### Auth & data model (the key cross-cutting concern)

**Clerk is the identity provider; Supabase is the database.** Clerk session tokens are passed to Supabase so RLS policies see the Clerk user. `user_id` columns store **Clerk user ids** (`user_...` strings) — early migrations referenced `auth.users`/`auth.uid()` but a later migration moved ownership to Clerk. Enable the Supabase integration in the Clerk dashboard so tokens carry `role: authenticated`.

Two distinct authorization paths, because secret-key code bypasses RLS:
- **User-facing** (web pages/actions): use the `./server` client and let RLS enforce ownership.
- **Trusted server code** (agent API in `app/api/v1/agent/`, MCP): use the `./service` client and authorize manually via helpers like `ensureIssueOwned` / `ensureProjectOwned`, which check ownership through the `issues → projects.user_id` join (the `issues` table has no `user_id` of its own).

The **agent API** authenticates with a Clerk **API key** (`Authorization: Bearer <key>`). Every `clerk.apiKeys.verify()` bills one Clerk usage and the worker polls constantly, so results are cached two tiers deep: L1 in-process memory + L2 Upstash Redis (keyed by a SHA-256 hash of the token). Redis is best-effort — if unset/unreachable, auth falls back to verifying against Clerk. See `apps/web/app/api/v1/agent/_lib.ts`.

## Conventions

- Prettier: **no semicolons**, double quotes, 2-space, `printWidth` 80, `trailingComma: es5`. Tailwind classes are auto-sorted; `cn`/`cva` are registered Tailwind functions.
- ESLint 9 flat config from `@gentic/eslint-config` (`/base` for libs, `/next` for web). `apps/mcp` lints with `--max-warnings 0`.
- Zod version is pinned via a pnpm `overrides` entry (`zod: 4.4.3`) — keep imports on that major.
