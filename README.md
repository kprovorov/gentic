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

## Supabase configuration

Password reset emails (`/forgot-password`) link back to `/auth/confirm`,
which is already used by the sign-up confirmation flow. In the Supabase
dashboard for your project, go to **Authentication > URL Configuration** and
make sure:

- **Site URL** is set to your app's deployed URL (e.g. `https://app.example.com`).
- **Redirect URLs** includes `https://app.example.com/auth/confirm` (or a
  wildcard such as `https://app.example.com/**`) so Supabase is allowed to
  redirect users back after they click the reset link.

No other changes are required — the "Reset Password" email template is
enabled by default and uses Supabase's built-in `{{ .ConfirmationURL }}`,
which already carries the redirect target. If you're running a
self-hosted/local Supabase instance via `supabase/config.toml`, update
`site_url` and `additional_redirect_urls` there instead.
