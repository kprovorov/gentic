alter table public.issues
  add column usage_limit_reset_at timestamptz;

alter table public.issues
  drop constraint issues_run_status_valid;

alter table public.issues
  add constraint issues_run_status_valid check (
    run_status is null
    or run_status in (
      'queued',
      'held',
      'cloning',
      'running',
      'completed',
      'failed',
      'cancelled'
    )
  );

create index issues_usage_limit_reset_at_idx
  on public.issues(usage_limit_reset_at)
  where run_status = 'held';
