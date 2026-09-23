#!/usr/bin/env bash
# Builds the Hermes test harness with the given module sources.
#   build.sh <output> <module.cpp>...
# Needs HERMES_DIR (a Hermes checkout built into $HERMES_DIR/build).
set -euo pipefail
here="$(cd "$(dirname "$0")" && pwd)"
cpp="$here/../../cpp"
hermes="${HERMES_DIR:-$HOME/hermes}"
out="$1"
shift
flags=(-std=c++20 -ffp-contract=off -g -O1 -Wall -Wno-unused-parameter -Wno-unused-function -I"$cpp" -I"$hermes/API" -I"$hermes/API/jsi" -I"$hermes/public" -I"$hermes/build/lib/config")
if [[ "${SANITIZE:-0}" == "1" ]]; then
  flags+=(-fsanitize=address,undefined -fno-omit-frame-pointer)
fi
${CXX:-clang++} "${flags[@]}" "$here/harness.cpp" "$@" "$cpp"/lucent/*.cpp "$cpp"/lucent/jsi/*.cpp \
  -L"$hermes/build/lib" -L"$hermes/build/jsi" -lhermesvm -ljsi -lpthread $([[ "$(uname)" == "Darwin" ]] && echo -framework CoreFoundation) \
  -Wl,-rpath,"$hermes/build/lib" -Wl,-rpath,"$hermes/build/jsi" -o "$out"
