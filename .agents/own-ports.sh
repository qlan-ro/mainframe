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

# runs_from <pid> <checkout>: whether its executable is in that checkout itself. Not for node, whose script counts.
runs_from() {
  [ -n "$2" ] || return 1
  exe="$(executable_of "$1")"
  case "$exe" in
    */node) return 1 ;;
    "$2"/*) [ "$(checkout_of_dir "$(dirname "$exe")")" = "$2" ] ;;
    *) return 1 ;;
  esac
}

# node_script <pid>: the real path of the script node runs, or nothing when its command line leaves that in doubt. ps
# does not say where an argument ends, so the script counts only right after node and flags known to take no word of
# their own: the value of `-r x` or `--title=a b` could be taken for it, or hide it.
node_script() (
  set -f
  # shellcheck disable=SC2046 # the words are what it reads
  set -- $(ps -ww -p "$1" -o command= 2>/dev/null)
  [ "$#" -gt 1 ] && [ "$(basename -- "$1")" = node ] || exit 0
  shift
  for arg in "$@"; do
    case "$arg" in
      --enable-source-maps | --no-warnings | --no-deprecation | --trace-warnings) continue ;;
      --max-old-space-size=*)
        case "${arg#*=}" in '' | *[!0-9]*) exit 0 ;; esac
        continue
        ;;
      /*) ;;
      *) exit 0 ;;
    esac
    [ -f "$arg" ] || exit 0
    # `/a/b c/d.js` reads as `/a/b` too, so a neighbour `b c` leaves it in doubt. No glob: zsh fails on one without match.
    # shellcheck disable=SC2012 # no option of find takes a name that is not a pattern
    ls -a "$(dirname "$arg")" | P="$(basename "$arg") " awk 'index($0, ENVIRON["P"]) == 1 {f = 1} END {exit !f}' && exit 0
    realpath "$arg" 2>/dev/null
    exit 0
  done
)

# is_ours <pid> <checkout>: whether the process is a server this checkout started: it runs in the checkout, and is
# built there or is node with a script of the checkout. The directory alone would also take an editor's, an agent's or
# anybody's server that was started in it, and so would a path of the checkout among the arguments. In doubt, not ours.
is_ours() {
  [ -n "$2" ] || return 1
  cwd="$(lsof -a -p "$1" -d cwd -Fn 2>/dev/null | sed -n 's/^n//p')"
  [ "$(checkout_of_dir "$cwd")" = "$2" ] || return 1
  runs_from "$1" "$2" && return 0
  [ "$(basename "$(executable_of "$1")")" = node ] || return 1
  script="$(node_script "$1")"
  [ -n "$script" ] && [ "$(checkout_of_dir "$(dirname "$script")")" = "$2" ]
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
