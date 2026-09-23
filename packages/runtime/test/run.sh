#!/usr/bin/env bash
# Builds and runs the runtime unit tests. `SANITIZE=1` adds ASan + UBSan.
set -euo pipefail
here="$(cd "$(dirname "$0")" && pwd)"
cpp="$here/../cpp"
out="${TMPDIR:-/tmp}/lucent-runtime-test"
flags=(-std=c++20 -ffp-contract=off -g -O1 -Wall -Wextra -Wno-unused-parameter -I"$cpp")
if [[ "${SANITIZE:-0}" == "1" ]]; then
  flags+=(-fsanitize=address,undefined -fno-omit-frame-pointer -fno-sanitize-recover=undefined)
fi
${CXX:-clang++} "${flags[@]}" "$here/runtime_test.cpp" "$cpp"/lucent/*.cpp -lpthread -o "$out"
"$out"
