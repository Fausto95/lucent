#!/usr/bin/env bash
# Builds the Hermes test harness with the given module sources.
#   build.sh <output> <module.cpp>...
# Needs HERMES_DIR (a Hermes checkout built into $HERMES_DIR/build).
# HARNESS=0 leaves harness.cpp out, for sources with a main of their own.
# SANITIZE=1 adds ASan and UBSan; SANITIZE=thread adds TSan.
set -euo pipefail
here="$(cd "$(dirname "$0")" && pwd)"
cpp="$here/../../cpp"
hermes="${HERMES_DIR:-$HOME/hermes}"
out="$1"
shift
flags=(-std=c++20 -ffp-contract=off -g -O1 -Wall -Wno-unused-parameter -Wno-unused-function -I"$cpp" -I"$hermes/API" -I"$hermes/API/jsi" -I"$hermes/public" -I"$hermes/build/lib/config")
if [[ "${SANITIZE:-0}" == "1" ]]; then
  # Not vptr: Hermes is built without RTTI, and on Linux its shared_ptr
  # releases bind to this binary's checked copies, which find no type info.
  flags+=(-fsanitize=address,undefined -fno-sanitize=vptr -fno-omit-frame-pointer)
elif [[ "${SANITIZE:-0}" == "thread" ]]; then
  flags+=(-fsanitize=thread -fno-omit-frame-pointer)
fi
harness=("$here/harness.cpp")
[[ "${HARNESS:-1}" == "0" ]] && harness=()
cobjs=()
for c in "$cpp"/third_party/quickjs/*.c; do
  o="${out}_$(basename "$c" .c).o"
  ${CC:-clang} -std=c11 -O2 -w -c "$c" -o "$o"
  cobjs+=("$o")
done
${CXX:-clang++} "${flags[@]}" ${harness[@]+"${harness[@]}"} "$@" "$cpp"/lucent/*.cpp "$cpp"/lucent/jsi/*.cpp "${cobjs[@]}" \
  -L"$hermes/build/lib" -L"$hermes/build/jsi" -lhermesvm -ljsi -lpthread $([[ "$(uname)" == "Darwin" ]] && echo -framework CoreFoundation) \
  -Wl,-rpath,"$hermes/build/lib" -Wl,-rpath,"$hermes/build/jsi" -o "$out"
