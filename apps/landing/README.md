# Gentic landing page

## Clerk waitlist

All acquisition CTAs link to `/waitlist`, which hosts Clerk’s prebuilt `Waitlist`
component. Clerk handles email collection, validation, confirmation, and waitlist
entries. Approvals and invitations are managed in the Clerk Dashboard.

Before running or deploying the landing app:

1. Set `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY` and `CLERK_SECRET_KEY` using the same
   Clerk application as `apps/web`. Use development keys locally and production
   keys on `gentic.chat`. See `.env.example`; keep real keys in `.env.local` or
   the deployment environment.
2. In the Clerk Dashboard, select **Access mode → Waitlist** and enable email.
   Configure both the development and production instances as appropriate.
3. Confirm that the existing-user sign-in URL is `https://app.gentic.chat/login`.

The publishable key must be available at build time. The secret key is used only
by the server-side Clerk proxy, which runs on `/waitlist` and its subpaths.
Clerk’s provider is scoped to the waitlist route so the marketing homepage stays
static and does not load Clerk’s client scripts.

Run `pnpm --filter @gentic/landing dev` after configuring the environment. Check
each **Join waitlist** link, submit a test email in the development instance, and
confirm that Clerk shows its success state and records the entry in the dashboard.

See [Clerk’s waitlist guide](https://clerk.com/docs/nextjs/guides/secure/waitlist).
