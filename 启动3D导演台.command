#!/bin/zsh
set -e

cd "$(dirname "$0")"

# The director server includes its own AnimoFlow remote-job proxy, so no separate
# Python service needs to be installed or started before opening the desk.

if [ ! -d node_modules ]; then
  npm install
fi

DIRECTOR_DESK_OPEN=1 npm run dev
