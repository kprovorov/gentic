# Gentic documentation

This directory contains the public Gentic product documentation. The site is
built with [Mintlify](https://mintlify.com/docs); page content is MDX and site
configuration and navigation live in `docs.json`.

## Content map

- `introduction.mdx`, `quickstart.mdx`, and `how-it-works.mdx` explain the core workflow.
- `web/` documents projects, issues, GitHub integration, and statuses.
- `agent/` documents worker installation, configuration, and service management.
- `mcp/` documents the hosted MCP endpoint and its tools.
- `guides/` contains task-focused walkthroughs and troubleshooting.

## Development

Install the [Mintlify CLI](https://mintlify.com/docs/cli) and start it from this
directory:

```
npm i -g mint
```

```bash
cd docs
mint dev
```

The local preview is available at `http://localhost:3000`. You can also run
`npx mint dev` without installing the CLI globally.

Before publishing, validate the site and check internal links:

```bash
mint validate
mint broken-links
```

## Publishing changes

Changes under this directory are deployed by the Mintlify GitHub integration
after they are merged into the configured production branch.

Keep product behavior in sync with the implementation. The worker CLI source is
in `apps/gentic/src`, shared workflow rules are in `packages/services` and
`packages/validators`, and web UI behavior is in `apps/web`.
