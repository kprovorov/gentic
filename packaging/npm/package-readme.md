# gentic-cli

The [Gentic](https://gentic.chat) agent host. It polls the Gentic API for
issues assigned to a coding agent, clones the project repository, and runs
Claude Code or Codex over the
[Agent Client Protocol](https://agentclientprotocol.com), streaming the
transcript back to the Gentic app.

## Install

```bash
npm install -g gentic-cli
```

Requires Node.js 20.19 or newer. The host also needs the `gh`, `claude`, and
`codex` CLIs installed and authenticated on the machine, plus SSH access to
the repositories it will clone. `gentic doctor` reports what is missing and
`gentic onboard` walks through the setup.

## Connect the host

Generate a host enrollment code in **Settings → Workspace → Hosts** in the
Gentic app, then run it on the machine that will do the work:

```bash
gentic host connect <code>
```

The code is single-use and expires after 10 minutes. It is exchanged for a
stable host id and credential, stored in an OS-appropriate config file
(`~/.config/gentic/config.json` on Linux) that survives restarts.

## Run it

```bash
gentic start    # install and start a managed background service
gentic status   # show what this host is doing
gentic stop     # stop the service
```

`gentic start` installs a real OS service — a systemd user unit on Linux or a
launchd agent on macOS — so the host restarts on crash and comes back after
a reboot. Use `gentic run` instead to run it in the foreground.

Run `gentic doctor` at any time to check credentials and required local tools.

## Documentation

Full installation, configuration, and service-management docs live in the
[Gentic docs](https://github.com/kprovorov/gentic/tree/main/docs/agent).
