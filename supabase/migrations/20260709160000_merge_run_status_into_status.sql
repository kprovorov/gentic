-- Collapse the two overlapping status fields into one. `status` gains the
-- values that used to live on `run_status` (queued, held, cloning) plus
-- `run-failed` for a failed agent run; `todo` is retired in favor of `queued`
-- and a finished run now resolves directly to `ready-for-review` or
-- `waiting-for-input` instead of a generic `completed` run state.
alter table public.issues
  drop constraint issues_status_valid;

alter table public.issues
  add constraint issues_status_valid
  check (status in (
    'draft',
    'queued',
    'held',
    'cloning',
    'in-progress',
    'waiting-for-input',
    'testing',
    'tests-failed',
    'ready-for-review',
    'changes-requested',
    'approved',
    'merged',
    'deploying',
    'deploy-failed',
    'validating',
    'run-failed',
    'completed',
    'cancelled'
  ));

update public.issues set status = 'held' where status = 'todo' and run_status = 'held';
update public.issues set status = 'queued' where status = 'todo';
update public.issues set status = 'cloning' where status = 'in-progress' and run_status = 'cloning';
update public.issues set status = 'run-failed' where status = 'in-progress' and run_status = 'failed';
update public.issues set status = 'waiting-for-input'
  where status = 'in-progress' and run_status = 'completed' and pr_url is null;
update public.issues set status = 'ready-for-review'
  where status = 'in-progress' and run_status = 'completed' and pr_url is not null;

drop index if exists issues_usage_limit_reset_at_idx;

alter table public.issues
  drop constraint issues_run_status_valid;

alter table public.issues
  drop column run_status;

create index issues_usage_limit_reset_at_idx
  on public.issues(usage_limit_reset_at)
  where status = 'held';
