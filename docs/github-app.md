# GitHub App setup

Gentic uses a GitHub App installation to connect a workspace to GitHub. Beyond
recording the installation, the app also drives pull request automation: PR
and review webhooks move an issue's status, and a `changes_requested` review
is fed back to the issue's agent session and re-queued automatically (unless
disabled per-project).

## Create the app

1. In GitHub, open **Settings > Developer settings > GitHub Apps > New GitHub App**.
2. Set **GitHub App name** to your production app name.
3. Set **Homepage URL** to your Gentic web app URL.
4. Set **Setup URL** to:

   ```text
   https://YOUR_GENTIC_DOMAIN/api/integrations/github/callback
   ```

5. Enable **Redirect on update** so repository access changes return to Gentic.
6. Add these repository permissions:
   - **Contents**: Read-only
   - **Issues**: Read and write
   - **Pull requests**: Read-only
   - **Metadata**: Read-only
7. Subscribe to these webhook events for the future automation work:
   - Pull request
   - Pull request review
   - Check run
   - Check suite
8. Choose whether the app should be public or private. Public is required if
   workspaces outside the app owner account need to install it.
9. Create the app, then copy the slug from `https://github.com/apps/<slug>` into
   the web app environment:

   ```bash
   GITHUB_APP_SLUG=<slug>
   ```

10. Under **General**, generate a **webhook secret** and set the **Webhook URL**
    to `https://YOUR_GENTIC_DOMAIN/api/integrations/github/webhook`. Put the
    secret in the web app environment as `GITHUB_WEBHOOK_SECRET`.
11. Note the **App ID** shown at the top of the app's settings page, and under
    **Private keys** click **Generate a private key** to download a `.pem`
    file. Set both in the web app environment:

    ```bash
    GITHUB_APP_ID=<app id>
    # Paste the full .pem contents, with literal `\n` line breaks if your
    # environment doesn't support real newlines in a single env var.
    GITHUB_APP_PRIVATE_KEY=<private key .pem contents>
    ```

    These sign the App JWT used to mint short-lived installation access
    tokens (via `POST /app/installations/{id}/access_tokens`), which the
    webhook handler uses to fetch a review's inline comments — the
    `pull_request_review` webhook payload only carries the review body, not
    its comments.

## Connect from Gentic

1. Deploy the environment variables and restart the web app.
2. Open **Settings** in Gentic.
3. Click **Connect GitHub**.
4. Install the GitHub App on the repositories Gentic should manage.
5. GitHub redirects back to Gentic, which stores the installation id.

GitHub documents that setup URL callbacks include an `installation_id`, but that
id should not be treated as fully verified by itself. Before using the
installation for write automation, add GitHub App credentials and validate the
installation with GitHub's API.

## Auto-respond to review feedback

When a reviewer submits a **Request changes** review on a PR Gentic created,
the webhook handler (`apps/web/app/api/integrations/github/webhook/route.ts`)
fetches the review's inline comments, composes them into a message on the
issue's transcript, and re-queues the run so the same agent session pushes
fixes to the existing branch instead of opening a new PR. If the comment
fetch fails (e.g. `GITHUB_APP_ID`/`GITHUB_APP_PRIVATE_KEY` misconfigured), it
falls back to the review body alone rather than dropping the event.

This is on by default per project; uncheck **Auto-respond to review
feedback** on a project in Settings to keep the older status-only behavior
(the issue still moves to `changes-requested`, but nothing is queued).
