-- Restore a `todo` status ahead of `queued` so the worker has somewhere to
-- claim issues from without them piling up in a visible "cloning repo" step:
-- `todo` (unclaimed) -> `queued` (claimed by a worker, cloning happens here
-- invisibly) -> `in-progress` (agent session running). The old `cloning`
-- status is retired.

alter table public.issues
  drop constraint issues_status_valid;

alter table public.issues
  add constraint issues_status_valid
  check (status in (
    'draft',
    'todo',
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

-- Order matters: shift the old pool status to `todo` before repurposing
-- `queued` for the old `cloning` rows, so the two updates don't collide.
update public.issues set status = 'todo' where status = 'queued';
update public.issues set status = 'queued' where status = 'cloning';

alter table public.issues
  drop constraint issues_status_valid;

alter table public.issues
  add constraint issues_status_valid
  check (status in (
    'draft',
    'todo',
    'queued',
    'held',
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
