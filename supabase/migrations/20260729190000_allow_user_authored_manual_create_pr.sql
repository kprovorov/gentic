alter table public.messages
  drop constraint if exists messages_generated_action_gentic_author;

alter table public.messages
  add constraint messages_generated_action_author_valid check (
    generated_action is null
    or author_type = 'gentic'
    or (role = 'user' and author_type = 'user')
  );

create unique index messages_issue_manual_create_pr_once_idx
  on public.messages(issue_id)
  where role = 'user'
    and author_type = 'user'
    and generated_action = 'create_pr';
