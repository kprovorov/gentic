create or replace function public.preserve_issue_automatic_pr_after_attach()
returns trigger
language plpgsql
security invoker
set search_path = public
as $$
begin
  if old.create_pr_automatically is distinct from new.create_pr_automatically
     and (
       old.pr_url is not null
       or new.pr_url is not null
       or exists (
         select 1
           from public.issue_pull_requests
          where issue_pull_requests.issue_id = old.id
       )
     ) then
    new.create_pr_automatically = old.create_pr_automatically;
  end if;

  return new;
end;
$$;

drop trigger if exists preserve_issue_automatic_pr_after_attach
  on public.issues;

create trigger preserve_issue_automatic_pr_after_attach
  before update of create_pr_automatically, pr_url
  on public.issues
  for each row
  execute function public.preserve_issue_automatic_pr_after_attach();

revoke all on function public.preserve_issue_automatic_pr_after_attach()
  from public;
grant execute on function public.preserve_issue_automatic_pr_after_attach()
  to authenticated;
grant execute on function public.preserve_issue_automatic_pr_after_attach()
  to service_role;
