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
source "$here/../parallel.sh"
harness=("$here/harness.cpp")
[[ "${HARNESS:-1}" == "0" ]] && harness=()

# The runtime's objects, built side by side once for these flags and sources:
# the harness's builds share them (keyed by the flags and every runtime file).
key=$(
  {
    printf '%s\n' "${flags[@]}" "${CC:-clang}" "${CXX:-clang++}"
    find "$cpp/lucent" "$cpp/third_party/quickjs" -type f \( -name '*.cpp' -o -name '*.c' -o -name '*.h' \) | sort | xargs cat
  } | cksum | tr -d ' '
)
rt="${TMPDIR:-/tmp}/lucent-jsi-runtime-$key"
if [[ ! -f "$rt/done" ]]; then
  work="$rt.$$"
  mkdir -p "$work"
  for c in "$cpp"/third_party/quickjs/*.c; do
    bg ${CC:-clang} -std=c11 -O2 -w -c "$c" -o "$work/$(basename "$c" .c).o"
  done
  for f in "$cpp"/lucent/*.cpp "$cpp"/lucent/jsi/*.cpp; do
    name="$(basename "$(dirname "$f")")_$(basename "$f" .cpp)"
    bg ${CXX:-clang++} "${flags[@]}" -c "$f" -o "$work/$name.o"
  done
  drain
  touch "$work/done"
  # Published whole: another build of the same runtime may have done it first.
  if [[ -d "$rt" ]]; then rm -rf "$work"; else mv "$work" "$rt"; fi
fi

# The test's own sources, side by side, then the binary.
own=()
for f in ${harness[@]+"${harness[@]}"} "$@"; do
  o="${out}_$(basename "$f" .cpp).o"
  bg ${CXX:-clang++} "${flags[@]}" -c "$f" -o "$o"
  own+=("$o")
done
drain
${CXX:-clang++} "${flags[@]}" "${own[@]}" "$rt"/*.o \
  -L"$hermes/build/lib" -L"$hermes/build/jsi" -lhermesvm -ljsi -lpthread $([[ "$(uname)" == "Darwin" ]] && echo -framework CoreFoundation) \
  -Wl,-rpath,"$hermes/build/lib" -Wl,-rpath,"$hermes/build/jsi" -o "$out"
