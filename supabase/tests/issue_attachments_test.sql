BEGIN;
SELECT plan(15);

SELECT has_column(
  'public',
  'attachments',
  'kind',
  'attachments carry an ownership kind'
);

INSERT INTO public.projects (
  id,
  user_id,
  name,
  repo,
  key
) VALUES (
  '10000000-0000-4000-8000-400000000001',
  'user_attach',
  'Attachment Project',
  'gentic/attachments',
  'ATT'
), (
  '10000000-0000-4000-8000-400000000002',
  'user_other',
  'Other Project',
  'gentic/other',
  'OTH'
);

INSERT INTO public.issues (
  id,
  project_id,
  title,
  prompt,
  status,
  number
) VALUES (
  '20000000-0000-4000-8000-400000000001',
  '10000000-0000-4000-8000-400000000001',
  'Attachment issue',
  'Prompt',
  'todo',
  1
);

INSERT INTO public.messages (
  id,
  issue_id,
  role,
  content
) VALUES (
  '30000000-0000-4000-8000-400000000001',
  '20000000-0000-4000-8000-400000000001',
  'user',
  'Prompt'
);

-- A durable Issue Attachment, a per-message Message Attachment, and an Issue
-- Attachment whose upload never completed.
INSERT INTO public.attachments (
  id,
  issue_id,
  message_id,
  kind,
  file_name,
  storage_path,
  upload_completed_at,
  created_at
) VALUES (
  '40000000-0000-4000-8000-400000000001',
  '20000000-0000-4000-8000-400000000001',
  NULL,
  'issue',
  'spec.md',
  '20000000-0000-4000-8000-400000000001/issue-spec.md',
  now() - interval '30 days',
  now() - interval '30 days'
), (
  '40000000-0000-4000-8000-400000000002',
  '20000000-0000-4000-8000-400000000001',
  '30000000-0000-4000-8000-400000000001',
  'message',
  'screenshot.png',
  '20000000-0000-4000-8000-400000000001/message-screenshot.png',
  now() - interval '30 days',
  now() - interval '30 days'
), (
  '40000000-0000-4000-8000-400000000003',
  '20000000-0000-4000-8000-400000000001',
  NULL,
  'issue',
  'half-uploaded.bin',
  '20000000-0000-4000-8000-400000000001/issue-half-uploaded.bin',
  NULL,
  now() - interval '30 days'
);

-- Historical rows keep their message semantics: the column defaults to
-- 'message' so nothing existing is reclassified.
INSERT INTO public.attachments (
  id,
  issue_id,
  message_id,
  file_name,
  storage_path,
  upload_completed_at
) VALUES (
  '40000000-0000-4000-8000-400000000004',
  '20000000-0000-4000-8000-400000000001',
  NULL,
  'legacy.txt',
  '20000000-0000-4000-8000-400000000001/legacy.txt',
  now()
);

SELECT is(
  (
    SELECT kind
      FROM public.attachments
     WHERE id = '40000000-0000-4000-8000-400000000004'
  ),
  'message',
  'attachments default to message ownership'
);

SELECT throws_ok(
  $$
    INSERT INTO public.attachments (
      issue_id,
      message_id,
      kind,
      file_name,
      storage_path
    ) VALUES (
      '20000000-0000-4000-8000-400000000001',
      '30000000-0000-4000-8000-400000000001',
      'issue',
      'bad.txt',
      '20000000-0000-4000-8000-400000000001/bad.txt'
    )
  $$,
  '23514',
  NULL,
  'an issue attachment cannot take a message owner'
);

SELECT ok(
  NOT has_column_privilege(
    'authenticated',
    'public.attachments',
    'kind',
    'UPDATE'
  ),
  'authenticated users cannot reclassify an attachment'
);
SELECT ok(
  has_column_privilege(
    'authenticated',
    'public.attachments',
    'message_id',
    'UPDATE'
  ),
  'authenticated users can still finish a message attachment upload'
);

-- Resetting the agent wipes the conversation. Issue Attachments must survive
-- it; Message Attachments lose their owner as they always have.
SELECT public.reset_issue_run(
  '20000000-0000-4000-8000-400000000001',
  'claude_code',
  NULL
);

SELECT is(
  (
    SELECT count(*)::integer
      FROM public.attachments
     WHERE id = '40000000-0000-4000-8000-400000000001'
       AND deleted_at IS NULL
       AND message_id IS NULL
  ),
  1,
  'issue attachments survive an agent reset'
);
SELECT is(
  (
    SELECT message_id
      FROM public.attachments
     WHERE id = '40000000-0000-4000-8000-400000000002'
  ),
  NULL::uuid,
  'message attachments lose their owner when the conversation is reset'
);

CREATE TEMP TABLE swept_paths AS
SELECT storage_path
  FROM public.delete_old_orphaned_attachments(interval '1 day');

SELECT is(
  (SELECT count(*)::integer FROM swept_paths),
  2,
  'the sweeper reclaims the orphaned message upload and the incomplete upload'
);
SELECT is(
  (
    SELECT count(*)::integer
      FROM swept_paths
     WHERE storage_path
       = '20000000-0000-4000-8000-400000000001/issue-spec.md'
  ),
  0,
  'the sweeper never reclaims a completed issue attachment'
);
SELECT is(
  (
    SELECT deleted_at
      FROM public.attachments
     WHERE id = '40000000-0000-4000-8000-400000000001'
  ),
  NULL::timestamptz,
  'a completed issue attachment stays live after a sweep'
);
SELECT isnt(
  (
    SELECT deleted_at
      FROM public.attachments
     WHERE id = '40000000-0000-4000-8000-400000000003'
  ),
  NULL::timestamptz,
  'an issue attachment whose upload never completed is still reclaimed'
);

UPDATE public.attachments
   SET storage_deleted_at = now()
 WHERE deleted_at IS NOT NULL;

SELECT is(
  public.delete_orphaned_attachment_rows(interval '1 day'),
  2,
  'row cleanup removes only the reclaimed attachments'
);
SELECT is(
  (
    SELECT count(*)::integer
      FROM public.attachments
     WHERE id = '40000000-0000-4000-8000-400000000001'
  ),
  1,
  'row cleanup leaves durable issue attachments alone'
);

SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims', '{"sub":"user_attach"}', true);

SELECT is(
  (
    SELECT count(*)::integer
      FROM public.attachments
     WHERE kind = 'issue'
  ),
  1,
  'the issue owner can read their issue attachments'
);

SELECT set_config('request.jwt.claims', '{"sub":"user_other"}', true);

SELECT is(
  (
    SELECT count(*)::integer
      FROM public.attachments
  ),
  0,
  'other users cannot read issue attachments'
);

SELECT * FROM finish();
ROLLBACK;
