#!/bin/sh
# Checks the Python port of the rules against the TypeScript engine: writes golden games (strategy play and random legal play,
# every table) from the engine and replays them through the port, comparing the state after every action. Run it after any
# change to either side. Exits non-zero if anything differs.
set -eu
here="$(cd "$(dirname "$0")" && pwd)"
tmp="$(mktemp -d)"
trap 'rm -rf "$tmp"' EXIT
(cd "$here/../../packages/engine" && npm run --silent golden -- "$tmp/strategy.jsonl" 20 && npm run --silent golden -- "$tmp/random.jsonl" 60 random)
cd "$here"
./sandboxed.sh uv run --offline python parity.py "$tmp/strategy.jsonl"
./sandboxed.sh uv run --offline python parity.py "$tmp/random.jsonl"
