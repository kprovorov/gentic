#!/bin/sh
# Runs after `apt install ./gentic_*.deb` unpacks /usr/bin/gentic and
# /usr/lib/gentic/vendor. Intentionally does not start anything: gentic has
# no persisted config until GENTIC_API_KEY/GENTIC_API_URL are set, and a
# service silently crash-looping on a fresh install is worse than doing
# nothing.
#
# Follow-up (not implemented yet, see apps/gentic packaging task): once a
# `gentic start --system` service-management command exists, this script
# should interactively offer to install and enable a system-wide systemd
# unit — skippable and safe under DEBIAN_FRONTEND=noninteractive (default to
# *not* starting unless the user opts in), calling `gentic start --system`
# rather than hand-rolling a unit file here.
set -e

cat <<'EOF'
gentic installed to /usr/bin/gentic.

Before running it, set GENTIC_API_KEY and GENTIC_API_URL (see
/usr/share/doc/gentic/readme.md, or apps/gentic/readme.md upstream) via
environment variables or `gentic login` once that command ships.

This package does not install or start a background service. Run
`gentic run` directly, or configure your own systemd unit / process
manager.
EOF
