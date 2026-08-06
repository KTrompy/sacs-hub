#!/usr/bin/env bash
# Stages every tracked change under src/ (skips the node_modules/.vite churn
# that shows up in `git status` but was never meant to be committed),
# commits with the message you pass in, and pushes.
#
# Usage:
#   ./push.sh "commit message here"

set -e

if [ -z "$1" ]; then
  echo "Usage: ./push.sh \"commit message\""
  exit 1
fi

# `supabase/` was missing from this list, so Edge Function source and the auth
# email templates were never committed — they only existed on whichever machine
# wrote them and in the deployed function itself. Nothing broke (the functions
# are deployed straight to Supabase, not through Vercel), but the repo was not
# a complete record of what's running.
git add src/ public/ supabase/ *.sql package.json package-lock.json vite.config.js index.html vercel.json README.md push.sh 2>/dev/null
git commit -m "$1"
git push
