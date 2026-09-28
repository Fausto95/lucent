#!/usr/bin/env bash
# Builds and runs the runtime unit tests. `SANITIZE=1` adds ASan + UBSan;
# `SANITIZE=thread` adds TSan (for the Lucent lock, execution contexts and scopes).
# A test binary fails the run on its exit status or on any sanitizer report.
set -euo pipefail
here="$(cd "$(dirname "$0")" && pwd)"
cpp="$here/../cpp"
out="${TMPDIR:-/tmp}/lucent-runtime-test"
flags=(-std=c++20 -ffp-contract=off -g -O1 -Wall -Wextra -Wno-unused-parameter -I"$cpp")
if [[ "${SANITIZE:-0}" == "1" ]]; then
  flags+=(-fsanitize=address,undefined -fno-omit-frame-pointer -fno-sanitize-recover=undefined)
  # Also stack use after return: a posted job or a coroutine frame reading
  # a frame that has returned.
  export ASAN_OPTIONS="detect_stack_use_after_return=1${ASAN_OPTIONS:+:$ASAN_OPTIONS}"
elif [[ "${SANITIZE:-0}" == "thread" ]]; then
  flags+=(-fsanitize=thread -fno-omit-frame-pointer)
fi
source "$here/run_binary.sh"
log="${out}_output.log"

# The check on test binaries themselves.
run_binary "$log" bash "$here/run_binary_test.sh"

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
run_binary "$log" "$out"

# Lifetime scopes and one-shot operations, with their thread races.
${CXX:-clang++} "${flags[@]}" "$here/scope_test.cpp" "$cpp"/lucent/*.cpp "${cobjs[@]}" "${libs[@]}" -o "${out}_scope"
run_binary "$log" "${out}_scope"

# Composing callbacks into promises and subscriptions: settled and cleaned
# up once, on their owner, whichever thread calls.
${CXX:-clang++} "${flags[@]}" "$here/callback_test.cpp" "$cpp"/lucent/*.cpp "${cobjs[@]}" "${libs[@]}" -o "${out}_callback"
run_binary "$log" "${out}_callback"

# Resources: open, closing and closed, released once on their thread.
${CXX:-clang++} "${flags[@]}" "$here/resource_test.cpp" "$cpp"/lucent/*.cpp "${cobjs[@]}" "${libs[@]}" -o "${out}_resource"
run_binary "$log" "${out}_resource"

# The app's and its scenes' lifecycle, as the platform reports it, and
# presentations that settle once however they end.
${CXX:-clang++} "${flags[@]}" "$here/lifecycle_test.cpp" "$cpp"/lucent/*.cpp "${cobjs[@]}" "${libs[@]}" -o "${out}_lifecycle"
"${out}_lifecycle"

# Native extensions: handles destroyed once on their context, and checked
# conversions of what crosses into C.
${CXX:-clang++} "${flags[@]}" "$here/extension_test.cpp" "$cpp"/lucent/*.cpp "${cobjs[@]}" "${libs[@]}" -o "${out}_extension"
"${out}_extension"

# Execution contexts: the legacy module context, the main context and
# isolated contexts, with what crosses between their threads.
${CXX:-clang++} "${flags[@]}" "$here/execution_test.cpp" "$cpp"/lucent/*.cpp "${cobjs[@]}" "${libs[@]}" -o "${out}_execution"
run_binary "$log" "${out}_execution"

# Isolated compute: copying a task's input, the bounded pool and what
# crosses between it and the task's owner.
${CXX:-clang++} "${flags[@]}" "$here/compute_test.cpp" "$cpp"/lucent/*.cpp "${cobjs[@]}" "${libs[@]}" -o "${out}_compute"
run_binary "$log" "${out}_compute"

# Native buffers: owned storage, borrows, transfer to tasks, and release on
# the executor the storage requires.
${CXX:-clang++} "${flags[@]}" "$here/buffer_test.cpp" "$cpp"/lucent/*.cpp "${cobjs[@]}" "${libs[@]}" -o "${out}_buffer"
run_binary "$log" "${out}_buffer"

# BigInt, checked against the answers node gives for a seeded corpus.
node "$here/bigint/corpus.ts" "${out}_bigint_corpus.txt"
${CXX:-clang++} "${flags[@]}" "$here/bigint_test.cpp" "$cpp"/lucent/*.cpp "${cobjs[@]}" "${libs[@]}" -o "${out}_bigint"
run_binary "$log" "${out}_bigint" "${out}_bigint_corpus.txt"

# Number to string (String(x), toString(radix), toFixed, toExponential,
# toPrecision), checked against the strings node gives for a seeded corpus.
node "$here/number/corpus.ts" "${out}_number_corpus.txt"
${CXX:-clang++} "${flags[@]}" "$here/number_test.cpp" "$cpp"/lucent/*.cpp "${cobjs[@]}" "${libs[@]}" -o "${out}_number"
run_binary "$log" "${out}_number" "${out}_number_corpus.txt"

# The UI reactive graph: every scenario of a seeded corpus, checked against
# the log the JavaScript reference (reactive/reference.ts) gives.
node "$here/reactive/corpus.ts" "${out}_reactive_corpus.txt"
${CXX:-clang++} "${flags[@]}" "$here/reactive_test.cpp" "$cpp"/lucent/*.cpp "${cobjs[@]}" "${libs[@]}" -o "${out}_reactive"
run_binary "$log" "${out}_reactive" "${out}_reactive_corpus.txt"

# What compiled views share: the main context's graph, events' routes and
# where a view's errors go.
${CXX:-clang++} "${flags[@]}" "$here/view_test.cpp" "$cpp"/lucent/*.cpp "${cobjs[@]}" "${libs[@]}" -o "${out}_view"
run_binary "$log" "${out}_view"

# Where the Android host finds each view's event emitter: by surface and
# tag (a tag alone is reused across runtimes), holding nothing alive.
${CXX:-clang++} "${flags[@]}" "$here/view_registry_test.cpp" -o "${out}_view_registry"
run_binary "$log" "${out}_view_registry"

# How a component's host sizes to its content: the pixel grid, which
# measurements the shadow tree accepts, and when the host measures.
${CXX:-clang++} "${flags[@]}" "$here/sizing_test.cpp" "$cpp"/lucent/*.cpp "${cobjs[@]}" "${libs[@]}" -o "${out}_sizing"
run_binary "$log" "${out}_sizing"

# Where a component lays out its React children: the slot's insets, which
# reports the shadow tree accepts, border edges, and when the host posts.
${CXX:-clang++} "${flags[@]}" "$here/slots_test.cpp" "$cpp"/lucent/*.cpp "${cobjs[@]}" "${libs[@]}" -o "${out}_slots"
run_binary "$log" "${out}_slots"

# A toolkit body's list, by key: items found again by key, and keys that
# two items share (or NaN) refused.
${CXX:-clang++} "${flags[@]}" "$here/items_test.cpp" "$cpp"/lucent/*.cpp "${cobjs[@]}" "${libs[@]}" -o "${out}_items"
run_binary "$log" "${out}_items"

# Requests Android answers later (activity results, permissions): settled
# once on the context that asked, forgotten on the platform when cancelled.
${CXX:-clang++} "${flags[@]}" "$here/android_requests_test.cpp" "$cpp"/lucent/*.cpp "${cobjs[@]}" "${libs[@]}" -o "${out}_android_requests"
run_binary "$log" "${out}_android_requests"

# Native operations as promises: settled on their owner, cancelled by a
# signal or their scope, late results released.
${CXX:-clang++} "${flags[@]}" "$here/operation_test.cpp" "$cpp"/lucent/*.cpp "${cobjs[@]}" "${libs[@]}" -o "${out}_operation"
"${out}_operation"

# Tracing: bounded, correlated events from the runtime's seams, and the
# three causes a trace tells apart (a queued job, a compute stall, a copy).
${CXX:-clang++} "${flags[@]}" "$here/trace_test.cpp" "$cpp"/lucent/*.cpp "${cobjs[@]}" "${libs[@]}" -o "${out}_trace"
"${out}_trace"

# The Objective-C glue helpers, on the macOS host (ARC).
if [[ "$(uname)" == "Darwin" ]]; then
  ${CXX:-clang++} "${flags[@]}" -fobjc-arc -x objective-c++ "$here/objc_test.mm" -x none "$cpp"/lucent/*.cpp "${cobjs[@]}" "${libs[@]}" -framework Foundation -o "${out}_objc"
  run_binary "$log" "${out}_objc"
fi

# The UIKit glue compiles against the iOS simulator SDK, where there is one.
if [[ "$(uname)" == "Darwin" ]] && xcrun --sdk iphonesimulator --show-sdk-path >/dev/null 2>&1; then
  xcrun --sdk iphonesimulator clang++ -std=c++20 -ffp-contract=off -fobjc-arc -fsyntax-only -target arm64-apple-ios15.1-simulator \
    -Wall -Wextra -Wno-unused-parameter -Werror -I"$cpp" -x objective-c++ "$cpp/lucent/platform/ios_ui.mm" "$here/ios_ui_check.mm"
  echo "ios_ui: compiles against the iOS simulator SDK"
fi
