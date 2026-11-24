#!/usr/bin/env bash
# Sourced by the teardown scripts. Stops what listens on a port only when it runs in the given checkout; anything
# else is somebody else's, and is named and left running. POSIX-clean, like stop-test.sh.

# The checkout a process runs in. A nested worktree is a checkout of its own.
checkout_of() {
  dir="$(lsof -a -p "$1" -d cwd -Fn 2>/dev/null | sed -n 's/^n//p')"
  [ -n "$dir" ] && git -C "$dir" rev-parse --show-toplevel 2>/dev/null
}

# Listeners only: without the state filter lsof also names the port's clients, browsers included.
listeners_on() {
  lsof -nP -t -iTCP:"$1" -sTCP:LISTEN 2>/dev/null | sort -u
}

# The app of this checkout, connected to the port: the Tauri shell, whose daemon is the listener. Told by its executable,
# so no browser or script that talks to the port is taken for it.
apps_on() {
  for client in $(lsof -nP -t -iTCP:"$1" -sTCP:ESTABLISHED 2>/dev/null | sort -u); do
    exe="$(lsof -a -p "$client" -d txt -Fn 2>/dev/null | sed -n 's/^n//p' | head -1)"
    case "$exe" in
      "$2"/*) [ "$(git -C "$(dirname "$exe")" rev-parse --show-toplevel 2>/dev/null)" = "$2" ] && echo "$client" ;;
    esac
  done
}

# stop_port <port> <checkout>: 0 when the port is free afterwards, 1 when something still holds it.
stop_port() {
  if [ "$1" = 31415 ]; then
    echo "REFUSED: 31415 is the installed app's daemon" >&2
    return 1
  fi
  own="$(git -C "$2" rev-parse --show-toplevel 2>/dev/null)"
  [ -n "$own" ] && for pid in $(apps_on "$1" "$own"); do kill -9 "$pid" 2>/dev/null; done
  for pid in $(listeners_on "$1"); do
    if [ -n "$own" ] && [ "$(checkout_of "$pid")" = "$own" ]; then
      kill -9 "$pid" 2>/dev/null
    else
      echo "LEFT: port $1 is held by pid $pid, which does not run in $2: $(ps -p "$pid" -o command= | cut -c1-200)" >&2
    fi
  done
  tries=0
  while [ -n "$(listeners_on "$1")" ]; do
    tries=$((tries + 1))
    [ "$tries" -gt 10 ] && return 1
    sleep 0.3
  done
  return 0
}
