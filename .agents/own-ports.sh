#!/usr/bin/env bash
# Sourced by the teardown scripts. Stops what listens on a port only when this checkout started it; anything else is
# somebody else's, and is named and left running. POSIX-clean, like stop-test.sh.

# The checkout a file or directory belongs to. A nested worktree is a checkout of its own.
checkout_of_dir() {
  [ -n "$1" ] && git -C "$1" rev-parse --show-toplevel 2>/dev/null
}

# The executable of a process, as the kernel has it, not as its command line says.
executable_of() {
  lsof -a -p "$1" -d txt -Fn 2>/dev/null | sed -n 's/^n//p' | head -1
}

# runs_from <pid> <checkout>: whether its executable is in that checkout itself.
runs_from() {
  [ -n "$2" ] || return 1
  exe="$(executable_of "$1")"
  case "$exe" in
    "$2"/*) [ "$(checkout_of_dir "$(dirname "$exe")")" = "$2" ] ;;
    *) return 1 ;;
  esac
}

# is_ours <pid> <checkout>: whether the process is a server this checkout started: it runs in the checkout, and is
# built there or is node with a script of the checkout. The directory alone would also take an editor's, an agent's or
# anybody's server that was started in it.
is_ours() {
  [ -n "$2" ] || return 1
  cwd="$(lsof -a -p "$1" -d cwd -Fn 2>/dev/null | sed -n 's/^n//p')"
  [ "$(checkout_of_dir "$cwd")" = "$2" ] || return 1
  runs_from "$1" "$2" && return 0
  [ "$(basename "$(executable_of "$1")")" = node ] || return 1
  for arg in $(ps -ww -p "$1" -o command= 2>/dev/null); do
    case "$arg" in
      "$2"/*) [ "$(checkout_of_dir "$(dirname "$arg")")" = "$2" ] && return 0 ;;
    esac
  done
  return 1
}

# check_port <port>: refuses the installed app's daemon, and whatever is not one plain port number. lsof also reads
# 031415, 31414-31416 and 1024,31415, so a comparison of strings would let those reach that daemon.
check_port() {
  case "$1" in
    '' | 0* | *[!0-9]* | ??????*)
      echo "REFUSED: '$1' is not a port" >&2
      return 1
      ;;
    31415)
      echo "REFUSED: 31415 is the installed app's daemon" >&2
      return 1
      ;;
  esac
}

# Listeners only: without the state filter lsof also names the port's clients, browsers included.
listeners_on() {
  lsof -nP -t -iTCP:"$1" -sTCP:LISTEN 2>/dev/null | sort -u
}

# The app of this checkout, connected to the port: the Tauri shell, whose daemon is the listener. Told by its executable,
# so no browser or script that talks to the port is taken for it.
apps_on() {
  for client in $(lsof -nP -t -iTCP:"$1" -sTCP:ESTABLISHED 2>/dev/null | sort -u); do
    runs_from "$client" "$2" && echo "$client"
  done
}

# stop_port <port> <checkout>: 0 when the port is free afterwards, 1 when something still holds it.
stop_port() {
  check_port "$1" || return 1
  own="$(checkout_of_dir "$2")"
  [ -n "$own" ] && for pid in $(apps_on "$1" "$own"); do kill -9 "$pid" 2>/dev/null; done
  for pid in $(listeners_on "$1"); do
    if [ -n "$own" ] && is_ours "$pid" "$own"; then
      kill -9 "$pid" 2>/dev/null
    else
      echo "LEFT: port $1 is held by pid $pid, which $2 did not start: $(ps -p "$pid" -o command= | cut -c1-200)" >&2
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
