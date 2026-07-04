alter table public.issues
  drop constraint issues_status_valid;

alter table public.issues
  add constraint issues_status_valid
  check (status in (
    'draft',
    'todo',
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
    'completed',
    'cancelled'
  ));
