begin;

select plan(21);

insert into public.projects (id, user_id, name, repo)
values
  ('00000000-0000-0000-0000-0000000000a1', 'user_a', 'User A project', 'owner-a/repo'),
  ('00000000-0000-0000-0000-0000000000b1', 'user_b', 'User B project', 'owner-b/repo');

insert into public.issues (
  id,
  project_id,
  title,
  prompt,
  status,
  agent_provider,
  type,
  session_id,
  run_started_at
)
values
  (
    '00000000-0000-0000-0000-0000000000a2',
    '00000000-0000-0000-0000-0000000000a1',
    'User A issue',
    'Prompt A',
    'waiting-for-input',
    'claude_code',
    'feature',
    'agent-session-a',
    now()
  ),
  (
    '00000000-0000-0000-0000-0000000000b2',
    '00000000-0000-0000-0000-0000000000b1',
    'User B issue',
    'Prompt B',
    'waiting-for-input',
    'claude_code',
    'feature',
    'agent-session-b',
    now()
  );

insert into public.messages (id, issue_id, role, content)
values
  (
    '00000000-0000-0000-0000-0000000000a3',
    '00000000-0000-0000-0000-0000000000a2',
    'assistant',
    'assistant transcript'
  ),
  (
    '00000000-0000-0000-0000-0000000000b3',
    '00000000-0000-0000-0000-0000000000b2',
    'assistant',
    'other user assistant transcript'
  );

set local role authenticated;
select set_config(
  'request.jwt.claims',
  '{"role":"authenticated","sub":"user_a"}',
  true
);

select is(
  (select count(*) from public.messages),
  1::bigint,
  'authenticated users can only read transcript rows for their own issues'
);

select lives_ok(
  $$
    select public.send_issue_user_message(
      '00000000-0000-0000-0000-0000000000a2',
      'allowed follow-up'
    )
  $$,
  'authenticated issue owners can append user messages through the authorized RPC'
);

select throws_like(
  $$
    insert into public.messages (
      id,
      issue_id,
      role,
      content,
      consumed_by_run_id,
      consumed_at
    )
    values (
      '00000000-0000-0000-0000-0000000000a4',
      '00000000-0000-0000-0000-0000000000a2',
      'user',
      'allowed follow-up',
      '00000000-0000-0000-0000-0000000000aa',
      now()
    )
  $$,
  '%permission denied%',
  'authenticated users cannot forge message run-consumption identity'
);

select throws_like(
  $$
    insert into public.messages (
      id,
      issue_id,
      role,
      content
    )
    values (
      '00000000-0000-0000-0000-0000000000a5',
      '00000000-0000-0000-0000-0000000000a2',
      'assistant',
      'forged assistant row'
    )
  $$,
  '%permission denied%',
  'authenticated users cannot forge assistant authorship'
);

select throws_like(
  $$
    select public.send_issue_user_message(
      '00000000-0000-0000-0000-0000000000b2',
      'cross-user insert'
    )
  $$,
  '%Issue not found%',
  'authenticated users cannot append messages to another user issue'
);

select throws_like(
  $$
    update public.messages
    set content = 'tampered'
    where id = '00000000-0000-0000-0000-0000000000a3'
  $$,
  '%permission denied%',
  'authenticated users cannot edit assistant transcript rows'
);

select throws_like(
  $$
    delete from public.messages
    where id = '00000000-0000-0000-0000-0000000000a3'
  $$,
  '%permission denied%',
  'authenticated users cannot delete assistant transcript rows'
);

select throws_like(
  $$
    update public.issues
    set session_id = 'forged-session'
    where id = '00000000-0000-0000-0000-0000000000a2'
  $$,
  '%permission denied%',
  'authenticated users cannot forge run session identity'
);

select throws_like(
  $$
    update public.issues
    set run_started_at = now()
    where id = '00000000-0000-0000-0000-0000000000a2'
  $$,
  '%permission denied%',
  'authenticated users cannot forge run timestamp identity'
);

select throws_like(
  $$
    update public.issues
    set active_run_id = '00000000-0000-0000-0000-0000000000aa'
    where id = '00000000-0000-0000-0000-0000000000a2'
  $$,
  '%permission denied%',
  'authenticated users cannot forge active run identity'
);

select throws_like(
  $$
    update public.issues
    set agent_provider = 'codex'
    where id = '00000000-0000-0000-0000-0000000000a2'
  $$,
  '%cannot change agent provider after run start%',
  'authenticated users cannot change agent provider after run start'
);

select lives_ok(
  $$
    insert into public.attachments (
      id,
      issue_id,
      file_name,
      storage_path
    )
    values (
      '00000000-0000-0000-0000-0000000000a6',
      '00000000-0000-0000-0000-0000000000a2',
      'notes.txt',
      '00000000-0000-0000-0000-0000000000a2/notes.txt'
    )
  $$,
  'authenticated issue owners can create matching attachment metadata'
);

select throws_like(
  $$
    insert into public.attachments (
      id,
      issue_id,
      file_name,
      storage_path
    )
    values (
      '00000000-0000-0000-0000-0000000000a7',
      '00000000-0000-0000-0000-0000000000a2',
      'mismatch.txt',
      '00000000-0000-0000-0000-0000000000b2/mismatch.txt'
    )
  $$,
  '%attachments_storage_path_issue_id_matches%',
  'attachment metadata storage paths must match their issue id'
);

select throws_like(
  $$
    insert into public.attachments (
      id,
      issue_id,
      file_name,
      storage_path
    )
    values (
      '00000000-0000-0000-0000-0000000000a8',
      '00000000-0000-0000-0000-0000000000b2',
      'cross-user.txt',
      '00000000-0000-0000-0000-0000000000b2/cross-user.txt'
    )
  $$,
  '%row-level security%',
  'authenticated users cannot create attachment metadata on another user issue'
);

select throws_like(
  $$
    select public.reset_issue_run(
      '00000000-0000-0000-0000-0000000000a2',
      'codex'
    )
  $$,
  '%permission denied%',
  'authenticated users cannot execute the unaudited reset function'
);

set local role service_role;
select set_config(
  'request.jwt.claims',
  '{"role":"service_role"}',
  true
);

select throws_like(
  $$
    select public.reset_issue_run_audited(
      '00000000-0000-0000-0000-0000000000a2',
      'codex',
      'user_b',
      'test wrong actor reset',
      'sql_test'
    )
  $$,
  '%Issue not found%',
  'audited reset requires the actor to own the issue'
);

select is(
  (
    select count(*)
    from public.messages
    where issue_id = '00000000-0000-0000-0000-0000000000a2'
  ),
  2::bigint,
  'failed wrong-actor reset does not delete transcript rows'
);

select lives_ok(
  $$
    select public.reset_issue_run_audited(
      '00000000-0000-0000-0000-0000000000a2',
      'codex',
      'user_a',
      'test trusted reset',
      'sql_test'
    )
  $$,
  'service role can perform the audited transcript reset'
);

select is(
  (
    select count(*)
    from public.transcript_audit_events
    where issue_id = '00000000-0000-0000-0000-0000000000a2'
  ),
  1::bigint,
  'trusted reset leaves an audit event'
);

select is(
  (
    select count(*)
    from public.messages
    where issue_id = '00000000-0000-0000-0000-0000000000a2'
  ),
  1::bigint,
  'trusted reset reseeds exactly one user message'
);

select is(
  (
    select agent_provider
    from public.issues
    where id = '00000000-0000-0000-0000-0000000000a2'
  ),
  'codex',
  'trusted reset can change the agent provider'
);

select * from finish();

rollback;
