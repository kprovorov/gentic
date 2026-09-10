-- GitHub App installation ownership was never proven.
--
-- `github_integrations.installation_id` is not user data, it is a capability
-- reference: `getInstallationToken` feeds it straight to
-- `POST /app/installations/{id}/access_tokens`, and the webhook handler
-- resolves an incoming delivery to an owner by looking the column up on its
-- own. Whoever writes that column decides whose repositories Gentic acts on.
--
-- Both paths that wrote it accepted the id from the caller. The OAuth
-- callback read it out of the query string, and these grants let the browser
-- skip the callback entirely and write the row through PostgREST with the
-- publishable key. Installation ids are not secret — they are the path
-- segment of the GitHub installation settings URL, they appear in every
-- webhook payload, and Settings prints one back to the user — so an
-- unclaimed installation belonging to someone else could be bound to an
-- attacker's account. From there: the victim's private repository names via
-- `fetchInstallationRepositories`, their pull request webhooks delivered
-- into the attacker's Issues, App-authored reviews, and `mergePullRequest`.
--
-- The route now verifies the installation against GitHub with a user access
-- token before writing. This takes the writes away from the browser so that
-- verification cannot be sidestepped: reads stay on RLS, writes go through
-- the service client with a server-derived Clerk user id.
revoke insert, update, delete on public.github_integrations from authenticated;

drop policy if exists "Users can create their own GitHub integration"
  on public.github_integrations;
drop policy if exists "Users can update their own GitHub integration"
  on public.github_integrations;
drop policy if exists "Users can delete their own GitHub integration"
  on public.github_integrations;

-- The setup state now carries the installation id across the user
-- authorization hop, which GitHub round-trips nothing but `state` through.
-- It is verified against GitHub either way, so the column is a continuation
-- token rather than a trusted fact — but the write moves to the service
-- client with the rest of the flow.
alter table public.github_integration_states
  add column if not exists installation_id text;

revoke insert, update, delete on public.github_integration_states
  from authenticated;

drop policy if exists "Users can create their own GitHub setup states"
  on public.github_integration_states;
drop policy if exists "Users can delete their own GitHub setup states"
  on public.github_integration_states;
