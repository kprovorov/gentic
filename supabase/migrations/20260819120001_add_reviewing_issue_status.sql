-- Automatic Code Review runs while a pull request is under an in-flight review
-- cycle. `reviewing` sits between `ready-for-review` and the human-facing
-- outcomes (`approved` / `changes-requested`) so the workflow can surface that
-- the automatic reviewer currently holds the pull request.

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
    'reviewing',
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
