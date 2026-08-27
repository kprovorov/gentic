-- GEN-430 fallout: the live Automatic Review E2E tier (the first code ever
-- to touch `public.projects`/`public.issues` directly as `service_role`,
-- rather than through a security-definer RPC) surfaced
-- `permission denied for table projects` the moment it actually ran in CI.
--
-- Every table's migration in this repo has, since `issue_pull_requests`,
-- carried its own explicit `grant ... to service_role` -- but `projects`
-- and `tasks` (renamed to `issues`) predate that convention and never got
-- one, and several tables since (`messages`, `issue_events`, `workers`,
-- `github_integrations`, `labels`, `issue_labels`, `attachments`,
-- `user_settings`, `issue_implementation_owners`, `issue_relations`, the
-- `worker_enrollment_*`/`worker_skill_installs` tables,
-- `github_integration_states`) never got one either. Production hasn't
-- noticed because every one of those is normally reached only through a
-- `security definer` RPC (which runs with the function owner's privileges,
-- not the caller's) or, per CLAUDE.md's own description of `./service`,
-- hosted Supabase already grants `service_role` blanket schema access by
-- default -- a default a fresh local CLI instance (used here in CI) does
-- not reproduce. Either way, `service_role` is documented to be a fully
-- trusted role that "must authorize every query themselves" at the
-- application layer, not the grant layer, so a per-table allowlist was
-- never the intended model.
--
-- Confirmed, not just inferred: `next_issue_number_for_project`
-- (20260725120001) is `security invoker`, does
-- `update public.projects set next_issue_number = ...`, and is already
-- granted EXECUTE to `service_role` -- so `service_role` was always
-- assumed to be able to write to `projects` directly. It just never had
-- the grant that assumption depends on, on a fresh local instance.
--
-- Grants blanket CRUD on every current table, plus default privileges so
-- every *future* table gets the same access automatically -- closing off
-- this entire class of silently-passing-in-production,
-- silently-failing-in-CI gap for good, which is exactly what this tier
-- exists to catch. Deliberately scoped to tables/sequences only, not
-- functions: every RPC this codebase actually wants `service_role` to call
-- already carries its own explicit `grant execute ... to service_role`,
-- and that per-function allowlist is a deliberate access-control surface
-- worth keeping explicit.
grant usage on schema public to service_role;
grant select, insert, update, delete on all tables in schema public to service_role;
grant usage, select on all sequences in schema public to service_role;

alter default privileges in schema public
  grant select, insert, update, delete on tables to service_role;
alter default privileges in schema public
  grant usage, select on sequences to service_role;
