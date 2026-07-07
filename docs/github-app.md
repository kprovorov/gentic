# GitHub App setup

Gentic uses a GitHub App installation to connect a workspace to GitHub. This
change only records the installation; pull request status automation is a later
step.

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

## Connect from Gentic

1. Deploy the environment variable and restart the web app.
2. Open **Settings** in Gentic.
3. Click **Connect GitHub**.
4. Install the GitHub App on the repositories Gentic should manage.
5. GitHub redirects back to Gentic, which stores the installation id.

GitHub documents that setup URL callbacks include an `installation_id`, but that
id should not be treated as fully verified by itself. Before using the
installation for write automation, add GitHub App credentials and validate the
installation with GitHub's API.
