BEGIN;
SELECT plan(11);

-- A Spec documents intent instead of requesting work: it is never handed to a
-- coding agent and has no conversation. The claim query filters Specs out, but
-- these three functions are the durable boundary — each refuses a Spec, so a
-- Spec that somehow reaches `todo` still never opens a run or grows a
-- transcript. Every rejection leaves the issue exactly as it was.

INSERT INTO public.projects (
  id,
  user_id,
  name,
  repo,
  key
) VALUES (
  '10000000-0000-4000-8000-600000000001',
  'user_spec',
  'Spec Project',
  'gentic/spec',
  'GEN'
);

INSERT INTO public.issues (
  id,
  project_id,
  title,
  body,
  status,
  type,
  number,
  agent_provider,
  session_id
) VALUES (
  -- A: a Spec draft — starting it must not open a run.
  '20000000-0000-4000-8000-600000000001',
  '10000000-0000-4000-8000-600000000001',
  'Billing rules',
  'The spec text',
  'draft',
  'spec',
  1,
  'claude_code',
  NULL
), (
  -- B: a Spec sitting in todo — resetting or messaging it must not open a run
  -- or add to its transcript.
  '20000000-0000-4000-8000-600000000002',
  '10000000-0000-4000-8000-600000000001',
  'Retention policy',
  'Another spec text',
  'todo',
  'spec',
  2,
  'claude_code',
  NULL
), (
  -- C: an ordinary feature draft, the control for every guard below.
  '20000000-0000-4000-8000-600000000003',
  '10000000-0000-4000-8000-600000000001',
  'Implement billing rules',
  'Feature body',
  'draft',
  'feature',
  3,
  'claude_code',
  NULL
);

-- Test 1: 'spec' is an accepted issue type.
SELECT lives_ok(
  $$ UPDATE public.issues SET type = 'spec'
      WHERE id = '20000000-0000-4000-8000-600000000003' $$,
  'an issue can be typed as a spec'
);

SELECT throws_ok(
  $$ UPDATE public.issues SET type = 'not-a-type'
      WHERE id = '20000000-0000-4000-8000-600000000003' $$,
  '23514',
  null,
  'an unknown issue type is still rejected'
);

UPDATE public.issues SET type = 'feature'
 WHERE id = '20000000-0000-4000-8000-600000000003';

-- Test 2: starting a Spec draft is refused and changes nothing.
SELECT throws_ok(
  $$ SELECT public.start_issue_from_draft('20000000-0000-4000-8000-600000000001') $$,
  '22023',
  null,
  'starting a spec draft is rejected'
);

SELECT is(
  (SELECT status FROM public.issues WHERE id = '20000000-0000-4000-8000-600000000001'),
  'draft',
  'the rejected spec stays in draft'
);

SELECT is(
  (SELECT count(*)::integer FROM public.messages
    WHERE issue_id = '20000000-0000-4000-8000-600000000001'),
  0,
  'no Kickoff Message is seeded for a spec'
);

-- Test 3: resetting a Spec is refused and leaves its transcript untouched.
SELECT throws_ok(
  $$ SELECT public.reset_issue_run(
       '20000000-0000-4000-8000-600000000002', 'claude_code') $$,
  '22023',
  null,
  'resetting a spec is rejected'
);

SELECT is(
  (SELECT count(*)::integer FROM public.messages
    WHERE issue_id = '20000000-0000-4000-8000-600000000002'),
  0,
  'a rejected reset seeds no Kickoff Message on a spec'
);

-- Test 4: a Spec has no conversation to send into.
SELECT throws_ok(
  $$ SELECT public.send_issue_user_message(
       '20000000-0000-4000-8000-600000000002', 'Please build this') $$,
  '22023',
  null,
  'sending a message to a spec is rejected'
);

SELECT is(
  (SELECT count(*)::integer FROM public.messages
    WHERE issue_id = '20000000-0000-4000-8000-600000000002'),
  0,
  'the rejected message is not written to the spec transcript'
);

-- Test 5: the guards are specific to Specs — agent work is untouched.
SELECT lives_ok(
  $$ SELECT public.start_issue_from_draft('20000000-0000-4000-8000-600000000003') $$,
  'starting a non-spec draft still succeeds'
);

SELECT is(
  (SELECT content FROM public.messages
    WHERE issue_id = '20000000-0000-4000-8000-600000000003'),
  'Work on Gentic issue GEN-3.',
  'the non-spec draft still gets its Kickoff Message'
);

SELECT * FROM finish();
ROLLBACK;
