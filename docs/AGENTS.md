# Documentation project instructions

## About this project

- This is a documentation site built on [Mintlify](https://mintlify.com)
- Pages are MDX files with YAML frontmatter
- Configuration lives in `docs.json`
- Product behavior must be verified against the code in `../apps` and `../packages`
- Worker CLI commands and configuration are defined in `../apps/gentic/src`
- Issue statuses and field constraints are defined in `../packages/validators`

## Terminology

- Use **agent worker** for the self-hosted `gentic` process.
- Use **agent** for Claude Code or Codex.
- Use **project** for a repository configuration in Gentic.
- Use status labels as they appear in the UI and code values in backticks.

## Style preferences

{/* Add any project-specific style rules below */}

- Use active voice and second person ("you")
- Keep sentences concise — one idea per sentence
- Use sentence case for headings
- Bold for UI elements: Click **Settings**
- Code formatting for file names, commands, paths, and code references

## Content boundaries

- Document user-facing web, worker, and MCP behavior.
- Do not present reserved workflow statuses as automated unless code drives them.
- Do not document internal test authentication or deployment secrets as user features.
