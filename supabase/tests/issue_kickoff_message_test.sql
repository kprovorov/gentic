BEGIN;
SELECT plan(23);

-- A fresh conversation opens with the fixed Kickoff Message
-- `Work on Gentic issue {Issue Code}.`, stored as a Gentic-authored user
-- message. Only the two lifecycle boundaries that create a fresh conversation
-- seed it: an initial draft start and an explicit agent reset. No Issue title,
-- Body excerpt, or Body fallback is ever sent.

INSERT INTO public.projects (
  id,
  user_id,
  name,
  repo,
  key
) VALUES (
  '10000000-0000-4000-8000-500000000001',
  'user_kickoff',
  'Kickoff Project',
  'gentic/kickoff',
  'GEN'
);

INSERT INTO public.issues (
  id,
  project_id,
  title,
  body,
  status,
  number,
  agent_provider,
  session_id
) VALUES (
  -- A: initial draft start.
  '20000000-0000-4000-8000-500000000001',
  '10000000-0000-4000-8000-500000000001',
  'Some descriptive issue title',
  'CONFIDENTIAL BODY TEXT that must never reach the transcript',
  'draft',
  1,
  'claude_code',
  NULL
), (
  -- B: a draft that already has a user message — starting it must not add a
  -- second Kickoff Message or rewrite the existing one.
  '20000000-0000-4000-8000-500000000002',
  '10000000-0000-4000-8000-500000000001',
  'Draft with prior conversation',
  'Draft body',
  'draft',
  2,
  'claude_code',
  NULL
), (
  -- C: an in-progress run with a session and transcript — reset wipes it and
  -- reseeds a single Kickoff Message.
  '20000000-0000-4000-8000-500000000003',
  '10000000-0000-4000-8000-500000000001',
  'Running issue',
  'Running body',
  'in-progress',
  3,
  'codex',
  'session-c'
), (
  -- D: reset with the other Coding Agent provider produces the same message.
  '20000000-0000-4000-8000-500000000004',
  '10000000-0000-4000-8000-500000000001',
  'Another running issue',
  'Another body',
  'in-progress',
  4,
  'claude_code',
  'session-d'
);

-- Pre-existing user message on B and a two-message transcript + PR on C.
INSERT INTO public.messages (issue_id, role, author_type, content) VALUES
  ('20000000-0000-4000-8000-500000000002', 'user', 'user', 'Existing follow-up'),
  ('20000000-0000-4000-8000-500000000003', 'user', 'gentic', 'Old kickoff'),
  ('20000000-0000-4000-8000-500000000003', 'assistant', 'agent', 'Old reply');

INSERT INTO public.issue_pull_requests (issue_id, url) VALUES
  ('20000000-0000-4000-8000-500000000003', 'https://github.com/gentic/kickoff/pull/3');

-- Test 1: initial draft start.
SELECT lives_ok(
  $$ SELECT public.start_issue_from_draft('20000000-0000-4000-8000-500000000001') $$,
  'starting a draft succeeds'
);

SELECT is(
  (SELECT status FROM public.issues WHERE id = '20000000-0000-4000-8000-500000000001'),
  'todo',
  'the started draft moves to todo'
);

SELECT is(
  (SELECT count(*)::integer FROM public.messages
    WHERE issue_id = '20000000-0000-4000-8000-500000000001'),
  1,
  'a draft start creates exactly one message'
);

SELECT is(
  (SELECT content FROM public.messages
    WHERE issue_id = '20000000-0000-4000-8000-500000000001'),
  'Work on Gentic issue GEN-1.',
  'the Kickoff Message is the exact fixed line naming the Issue Code'
);

SELECT is(
  (SELECT role FROM public.messages
    WHERE issue_id = '20000000-0000-4000-8000-500000000001'),
  'user',
  'the Kickoff Message is delivered with user-role semantics'
);

SELECT is(
  (SELECT author_type FROM public.messages
    WHERE issue_id = '20000000-0000-4000-8000-500000000001'),
  'gentic',
  'the Kickoff Message is Gentic-authored'
);

SELECT ok(
  (SELECT content FROM public.messages
    WHERE issue_id = '20000000-0000-4000-8000-500000000001')
    NOT LIKE '%CONFIDENTIAL%',
  'the Kickoff Message carries no Body excerpt or fallback'
);

-- Test 2: starting a draft that already has a user message is a no-op for the
-- transcript (retries / already-seeded issues do not get a second Kickoff
-- Message, and existing messages are not rewritten).
SELECT lives_ok(
  $$ SELECT public.start_issue_from_draft('20000000-0000-4000-8000-500000000002') $$,
  'starting a draft with an existing user message succeeds'
);

SELECT is(
  (SELECT count(*)::integer FROM public.messages
    WHERE issue_id = '20000000-0000-4000-8000-500000000002'),
  1,
  'no second Kickoff Message is created when a user message already exists'
);

SELECT is(
  (SELECT content FROM public.messages
    WHERE issue_id = '20000000-0000-4000-8000-500000000002'),
  'Existing follow-up',
  'the existing message is left untouched'
);

-- Test 3: explicit agent reset (claude_code) wipes the conversation and reseeds
-- a single Kickoff Message.
SELECT lives_ok(
  $$ SELECT public.reset_issue_run(
       '20000000-0000-4000-8000-500000000003', 'claude_code', 'claude-opus-4-8') $$,
  'resetting a running issue succeeds'
);

SELECT is(
  (SELECT count(*)::integer FROM public.messages
    WHERE issue_id = '20000000-0000-4000-8000-500000000003'),
  1,
  'a reset leaves exactly one message'
);

SELECT is(
  (SELECT content FROM public.messages
    WHERE issue_id = '20000000-0000-4000-8000-500000000003'),
  'Work on Gentic issue GEN-3.',
  'the reset Kickoff Message names the Issue Code'
);

SELECT is(
  (SELECT author_type FROM public.messages
    WHERE issue_id = '20000000-0000-4000-8000-500000000003'),
  'gentic',
  'the reset Kickoff Message is Gentic-authored'
);

SELECT is(
  (SELECT role FROM public.messages
    WHERE issue_id = '20000000-0000-4000-8000-500000000003'),
  'user',
  'the reset Kickoff Message has user-role semantics'
);

SELECT is(
  (SELECT status FROM public.issues WHERE id = '20000000-0000-4000-8000-500000000003'),
  'todo',
  'the reset issue is requeued to todo'
);

SELECT is(
  (SELECT agent_provider FROM public.issues WHERE id = '20000000-0000-4000-8000-500000000003'),
  'claude_code',
  'the reset applies the requested Coding Agent provider'
);

SELECT ok(
  (SELECT session_id IS NULL FROM public.issues WHERE id = '20000000-0000-4000-8000-500000000003'),
  'the reset clears the prior ACP session so the next run starts fresh'
);

SELECT is(
  (SELECT count(*)::integer FROM public.issue_pull_requests
    WHERE issue_id = '20000000-0000-4000-8000-500000000003'),
  0,
  'the reset clears prior pull request links'
);

-- Test 4: the other Coding Agent provider yields the same fixed Kickoff Message.
SELECT lives_ok(
  $$ SELECT public.reset_issue_run(
       '20000000-0000-4000-8000-500000000004', 'codex') $$,
  'resetting with the codex provider succeeds'
);

SELECT is(
  (SELECT content FROM public.messages
    WHERE issue_id = '20000000-0000-4000-8000-500000000004'),
  'Work on Gentic issue GEN-4.',
  'the codex reset produces the same fixed Kickoff Message'
);

SELECT is(
  (SELECT agent_provider FROM public.issues WHERE id = '20000000-0000-4000-8000-500000000004'),
  'codex',
  'the codex reset applies the codex provider'
);

-- Test 5: an invalid provider is rejected before anything is written.
SELECT throws_ok(
  $$ SELECT public.reset_issue_run(
       '20000000-0000-4000-8000-500000000004', 'not-a-provider') $$,
  '22023',
  null,
  'an unknown Coding Agent provider is rejected'
);

SELECT * FROM finish();
ROLLBACK;
