-- The `pull_request` webhook carries a PR's state, but the matching
-- `issue_pull_requests` row is only created when the worker attaches the PR at
-- run finish (see apps/web/app/api/v1/agent/issues/[id]/run-state/route.ts).
-- The agent typically opens the PR earlier in the run, so GitHub's `opened` /
-- `synchronize` deliveries can arrive before that row exists —
-- `updatePullRequestStateByPrUrl` then updates zero rows and the state is lost,
-- and `opened` never fires again. The pill is left stuck at "status
-- unavailable".
--
-- This url-keyed buffer lets the webhook persist the last state it saw for a PR
-- regardless of whether the PR has been attached yet. When the worker finally
-- attaches the PR, it adopts the buffered state into
-- `issue_pull_requests.state`. Written by the webhook and read by the attach
-- path, both of which use the service (secret-key) client, so no authenticated
-- access is needed: RLS stays on with no policies (deny-all for anon /
-- authenticated).
create table if not exists public.pull_request_states (
  url text primary key,
  state text not null
    check (state in ('draft', 'open', 'merged', 'closed', 'queued')),
  updated_at timestamptz not null default now()
);

alter table public.pull_request_states enable row level security;
