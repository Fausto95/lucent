#!/usr/bin/env bash
# Builds and runs the runtime unit tests. `SANITIZE=1` adds ASan + UBSan;
# `SANITIZE=thread` adds TSan (for the Lucent lock and the scheduler).
set -euo pipefail
here="$(cd "$(dirname "$0")" && pwd)"
cpp="$here/../cpp"
out="${TMPDIR:-/tmp}/lucent-runtime-test"
flags=(-std=c++20 -ffp-contract=off -g -O1 -Wall -Wextra -Wno-unused-parameter -I"$cpp")
if [[ "${SANITIZE:-0}" == "1" ]]; then
  flags+=(-fsanitize=address,undefined -fno-omit-frame-pointer -fno-sanitize-recover=undefined)
elif [[ "${SANITIZE:-0}" == "thread" ]]; then
  flags+=(-fsanitize=thread -fno-omit-frame-pointer)
fi
libs=(-lpthread)
# localeCompare uses CoreFoundation on Apple platforms, as on iOS.
[[ "$(uname)" == "Darwin" ]] && libs+=(-framework CoreFoundation)
# The vendored regular expression engine is C.
cobjs=()
for c in "$cpp"/third_party/quickjs/*.c; do
  o="${out}_$(basename "$c" .c).o"
  ${CC:-clang} -std=c11 -O2 -w $([[ "${SANITIZE:-0}" == "1" ]] && echo -fsanitize=address,undefined) $([[ "${SANITIZE:-0}" == "thread" ]] && echo -fsanitize=thread) -c "$c" -o "$o"
  cobjs+=("$o")
done
${CXX:-clang++} "${flags[@]}" "$here/runtime_test.cpp" "$cpp"/lucent/*.cpp "${cobjs[@]}" "${libs[@]}" -o "$out"
"$out"

# The Objective-C glue helpers, on the macOS host (ARC).
if [[ "$(uname)" == "Darwin" ]]; then
  ${CXX:-clang++} "${flags[@]}" -fobjc-arc -x objective-c++ "$here/objc_test.mm" -x none "$cpp"/lucent/*.cpp "${cobjs[@]}" "${libs[@]}" -framework Foundation -o "${out}_objc"
  "${out}_objc"
fi
