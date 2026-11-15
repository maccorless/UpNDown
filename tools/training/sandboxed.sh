#!/bin/sh
# Run any command with every network operation refused (macOS sandbox). Training and evaluation always go through this:
#   tools/training/sandboxed.sh uv run --offline python train.py
#   tools/training/sandboxed.sh npm run sim --workspace @upndown/engine -- calibrate
# Installing packages is a separate, deliberate step (`uv sync`) and is the only thing that uses the network.
set -eu
here="$(cd "$(dirname "$0")" && pwd)"
exec sandbox-exec -f "$here/no-network.sb" "$@"
