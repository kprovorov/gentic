-- Auto-derived, non-editable short project key (e.g. "GEN"), used as a
-- human-friendly project prefix. Derivation: uppercase the letters of the
-- first word of the project name, truncate to 3, or pad by repeating the
-- last letter if it has fewer than 3 letters; if the first word has no
-- letters at all, fall back to "PRJ". Collisions within the same user are
-- resolved by appending a numeric suffix (2, 3, 4, ...).

alter table public.projects add column key text;

do $$
declare
  proj record;
  first_word text;
  letters text;
  base_key text;
  candidate_key text;
  suffix int;
begin
  for proj in
    select id, user_id, name
    from public.projects
    order by user_id, created_at
  loop
    first_word := split_part(trim(proj.name), ' ', 1);
    letters := upper(regexp_replace(first_word, '[^A-Za-z]', '', 'g'));

    if length(letters) = 0 then
      base_key := 'PRJ';
    elsif length(letters) >= 3 then
      base_key := substring(letters from 1 for 3);
    else
      base_key := rpad(letters, 3, right(letters, 1));
    end if;

    candidate_key := base_key;
    suffix := 2;

    while exists (
      select 1 from public.projects
      where user_id = proj.user_id
        and key = candidate_key
        and id <> proj.id
    ) loop
      candidate_key := base_key || suffix::text;
      suffix := suffix + 1;
    end loop;

    update public.projects set key = candidate_key where id = proj.id;
  end loop;
end $$;

alter table public.projects
  alter column key set not null;

alter table public.projects
  add constraint projects_key_format check (key ~ '^[A-Z]{3}[0-9]*$');

alter table public.projects
  add constraint projects_user_key_unique unique (user_id, key);
