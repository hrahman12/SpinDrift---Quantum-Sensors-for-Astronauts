#!/usr/bin/env bash
# Vercel build for the public site.
# 1. Compile the Lean checker (lean/, core library only) for Linux, so POST /api/verdict can run it. elan reads
#    lean/lean-toolchain and installs exactly that Lean version.
# 2. Assemble the static page in public/: the app (ui/) and the data it reads (data/), at the same paths the local
#    server uses (/ui/..., /data/...).
set -euo pipefail
if ! command -v elan >/dev/null 2>&1; then
  curl -sSfL https://raw.githubusercontent.com/leanprover/elan/master/elan-init.sh | sh -s -- -y --default-toolchain none
fi
export PATH="$HOME/.elan/bin:$PATH"
(cd lean && lake build spindrift-check && ls -la .lake/build/bin/)
rm -rf public && mkdir -p public
cp -r ui public/ui
cp -r data public/data
rm -rf public/data/literature/raw
du -sh public
