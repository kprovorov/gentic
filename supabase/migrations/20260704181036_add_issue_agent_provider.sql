alter table public.issues
  add column agent_provider text not null default 'claude_code';

alter table public.issues
  add constraint issues_agent_provider_valid check (
    agent_provider in ('claude_code', 'codex')
  );
