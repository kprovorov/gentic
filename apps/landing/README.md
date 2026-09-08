# Gentic landing page

## Clerk waitlist

Every **Join waitlist** link uses `#waitlist` to scroll to the email form in the
homepage’s closing section. Native anchors work independently of Clerk and
respect the page’s reduced-motion settings. Old `/waitlist` URLs redirect to
`/#waitlist`.

The form uses the shared UI Input, Label, and Button with Clerk’s `useWaitlist()`
and `waitlist.join({ emailAddress })`. It displays loading, submission, error,
and success states inline. Clerk stores entries and manages invitations.

Before running or deploying:

1. Set `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY` at build time using the same Clerk
   application as `apps/web`. Use development keys locally and production keys
   on `gentic.chat`. See `.env.example`; keep real keys in `.env.local` or the
   deployment environment.
2. Enable **Access mode → Waitlist** and email in the Clerk Dashboard for the
   corresponding instance.

No secret key, server proxy, or authenticated route is needed for this public
client-side form. The Clerk provider wraps only the form; the homepage remains
statically rendered. If the publishable key is missing, the form displays an
unavailable message instead of breaking the page or pretending to accept emails.

Run `pnpm --filter @gentic/landing dev`. Check the header, hero, and footer links
scroll to the form, invalid email validation, loading/disabled states, and mobile
layout. With an approved test email in the development instance, check that a
successful signup shows confirmation and creates an entry in Clerk.

See [Clerk’s custom waitlist guide](https://clerk.com/docs/nextjs/guides/development/custom-flows/authentication/waitlist).

## Product screenshots

The landing page uses the actual Gentic components with deterministic example
project data. Captures are lossless PNGs at `deviceScaleFactor: 2`:

- `issues.png` and `planning.png`: 2880 × 2080. Active work and planning views,
  with varied statuses, agents, priorities, colored labels, dependencies and PRs.
- `agents.png`: populated issue composer and its complete agent/model menu.
- `review.png`: 2352 × 1648. Review findings, implementation fix, approval and PR.

Images are served unoptimized to preserve lossless text and 2× detail, with
intrinsic dimensions to prevent layout shifts. Feature captures load lazily.
The hero identifies the content as example data and offers both workspace views.

See `../web/screenshots/README.md` for the repeatable local capture procedure.
