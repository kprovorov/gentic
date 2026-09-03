# 11. Hosts replace connected workers

Date: 2026-09-03

## Status

Accepted

## Context

The machine that claims an Issue, clones the repo and drives a coding agent
was called a *connected worker*. GEN-435 renames it to a **host**, and asks
that only that word survive.

The word reached almost everything: four database tables and their columns on
`issues`, `review_runs` and `issue_implementation_owners`; the RPCs the web
app and the agent API call; the `@gentic/services/workers` and
`@gentic/validators/workers` entry points; the agent API's URL paths and the
field names inside its request and response bodies; the CLI's `worker` verb,
its `GENTIC_WORKER_*` settings and the config file it persists them to; the
Settings UI; and the docs. A rename that stops at any of those boundaries
leaves the codebase spelling the concept both ways, which is the thing the
Issue exists to remove.

Two of those boundaries are contracts with software that is already deployed
and does not auto-update: the agent API (called by installed CLI binaries) and
the config file (written on every enrolled machine). They have to be decided
separately, because they fail differently.

## Decision

**Rename the concept everywhere, and treat the two external boundaries
according to whether compatibility is achievable at all.**

**The agent API takes a clean break.** Response bodies are parsed by the CLI
with `.strict()` Zod schemas, so an added key is rejected just as loudly as a
missing one — there is no shape that satisfies both a pre-rename and a
post-rename CLI at once. Serving old paths alongside new ones would therefore
buy nothing: the old CLI would reach the endpoint and still fail on the body.
Given that, `defaultHostCompatibilityPolicy` raises the supported floor to
0.26.0, so the claim endpoints answer a pre-rename CLI with the
already-existing "unsupported version" rejection — a signal an operator can
see in **Settings → Workspace → Hosts** and act on — instead of letting it
spin on 404s from endpoints that no longer exist.

**The persisted config file keeps working.** `GENTIC_WORKER_ID`,
`GENTIC_WORKER_CREDENTIAL` and `GENTIC_WORKER_SETUP_STATE` are still read from
both the config file and the environment, and the file rewrites itself under
the new names on its next write. This is not symmetry with the API decision,
it is a different situation: the credential is stored only as a SHA-256 hash
server-side and the enrollment code that minted it was single-use, so a host
whose config file stopped being understood could not recover its identity —
every machine would need a manual re-enrollment. Six lines of alias avoid
that, and upgrading the CLI stays an upgrade.

**The `gtwc_` credential prefix does not change.** It abbreviates "gentic
worker credential", but it is an opaque token prefix rather than vocabulary,
and it is frozen by every credential already issued. Minting `gthc_` for new
hosts would split the format in two, permanently, for a mnemonic no user
reads.

**Applied migrations are not edited.** `supabase/migrations/*worker*.sql` keep
their file names and their SQL; they are the record of what ran. The rename is
a forward migration, and the one test that asserts on that history quotes the
old names deliberately.

**`gentic worker` survives as a hidden alias** of `gentic host`, so existing
muscle memory and older blog posts keep working while `--help` only ever
teaches "host".

## Consequences

Upgrading Gentic is a coordinated deploy: the web app and every host's CLI
must move to 0.26.0 together. Hosts left on 0.25.x stay visible and keep their
identity, but are marked **Unsupported** and are given no work until their CLI
is upgraded. No credential is invalidated and nothing needs re-enrolling.

Renaming a table does not rewrite the PL/pgSQL functions that read it —
bodies are stored as opaque text and would fail at their next call. The
migration therefore redefines all eighteen affected functions. Eleven change
name or parameter names and so cannot use `create or replace` (Postgres
refuses to rename an input parameter); they are dropped and recreated, which
drops their grants, re-issued in the same migration. The remaining seven keep
their signature and go through `create or replace`, which preserves their
grants and the triggers that depend on them. Any future rename of a table
these functions touch owes the same treatment.

Historic `issue_events` rows still carry `reason.code =
'assigned_worker_offline'`, and historic `issues.run_error` values still read
"Assigned worker went offline". Nothing in the application reads either — the
timeline renders `run_error` verbatim — so they are left as written rather
than backfilled.

`per_worker` in `supabase/config.toml` is a Supabase CLI keyword and is
untouched. The `.design-sync/previews/` fixtures are tool-generated artifacts
already drifted from the shipped UI and were left alone.
