#!/usr/bin/env bash
# Builds and runs the runtime unit tests. `SANITIZE=1` adds ASan + UBSan;
# `SANITIZE=thread` adds TSan (for the Lucent lock, execution contexts and scopes).
# A test binary fails the run on its exit status or on any sanitizer report.
set -euo pipefail
here="$(cd "$(dirname "$0")" && pwd)"
cpp="$here/../cpp"
out="${TMPDIR:-/tmp}/lucent-runtime-test"
flags=(-std=c++20 -ffp-contract=off -ffile-prefix-map="$(cd "$here/../../.." && pwd)"=. -g -O1 -Wall -Wextra -Wno-unused-parameter -I"$cpp")
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

source "$here/parallel.sh"

# Each test binary is its test file linked with the runtime, which compiles
# once for all of them.
tests=(runtime_test scope_test callback_test resource_test lifecycle_test extension_test
  execution_test compute_test buffer_test bigint_test number_test reactive_test view_test
  view_registry_test sizing_test slots_test items_test ui_children_test android_requests_test operation_test
  trace_test layout_test debug_test)
binary() { [[ "$1" == runtime_test ]] && echo "$out" || echo "${out}_${1%_test}"; }
objs="${out}_objs"
rm -rf "$objs"
mkdir -p "$objs"

# The vendored regular expression engine is C.
cobjs=()
for c in "$cpp"/third_party/quickjs/*.c; do
  o="$objs/$(basename "$c" .c).o"
  bg ${CC:-clang} -std=c11 -O2 -w $([[ "${SANITIZE:-0}" == "1" ]] && echo -fsanitize=address,undefined) $([[ "${SANITIZE:-0}" == "thread" ]] && echo -fsanitize=thread) -c "$c" -o "$o"
  cobjs+=("$o")
done
drain

# The vendored C defines only lucent_ symbols (lucent_prefix.h): an app
# that links another QuickJS gets no duplicate or interposed one. The
# sanitizers' own symbols (___asan_globals_registered, __odr_asan_gen_…)
# are the instrumentation's, not the engine's.
leaked=$(nm -g --defined-only "${cobjs[@]}" | awk 'NF == 3 && $3 !~ /^_?lucent_/ && $3 !~ /^_*(asan|odr_asan|tsan|ubsan)/ { print $3 }' | sort -u)
if [[ -n "$leaked" ]]; then
  echo "symbols: the vendored QuickJS defines unprefixed global symbols:" $leaked >&2
  exit 1
fi
echo "symbols: the vendored QuickJS's global symbols are all prefixed"

robjs=()
for f in "$cpp"/lucent/*.cpp; do
  o="$objs/runtime_$(basename "$f" .cpp).o"
  bg ${CXX:-clang++} "${flags[@]}" -c "$f" -o "$o"
  robjs+=("$o")
done
# The layout core is React Native's Yoga: its sources, from the example app's react-native.
yoga="$here/../../../apps/bare-example/node_modules/react-native/ReactCommon/yoga"
[[ -d "$yoga" ]] || yoga="$here/../../../node_modules/react-native/ReactCommon/yoga"
yobjs=()
while IFS= read -r f; do
  o="$objs/yoga_$(echo "${f#"$yoga"/}" | tr / _ | sed 's/\.cpp$//').o"
  bg ${CXX:-clang++} "${flags[@]}" -w -I"$yoga" -c "$f" -o "$o"
  yobjs+=("$o")
done < <(find "$yoga/yoga" -name '*.cpp' | sort)
for t in "${tests[@]}"; do
  bg ${CXX:-clang++} "${flags[@]}" -I"$yoga" -c "$here/$t.cpp" -o "$objs/$t.o"
done
if [[ "$(uname)" == "Darwin" ]]; then
  bg ${CXX:-clang++} "${flags[@]}" -fobjc-arc -x objective-c++ -c "$here/objc_test.mm" -o "$objs/objc_test.o"
fi
# Seeded corpora, with the answers node gives.
bg node "$here/bigint/corpus.ts" "${out}_bigint_corpus.txt"
bg node "$here/number/corpus.ts" "${out}_number_corpus.txt"
bg node "$here/reactive/corpus.ts" "${out}_reactive_corpus.txt"
drain

for t in "${tests[@]}"; do
  if [[ "$t" == view_registry_test ]]; then
    bg ${CXX:-clang++} "${flags[@]}" "$objs/$t.o" -o "$(binary "$t")"
  elif [[ "$t" == layout_test ]]; then
    bg ${CXX:-clang++} "${flags[@]}" "$objs/$t.o" "${yobjs[@]}" "${robjs[@]}" "${cobjs[@]}" "${libs[@]}" -o "$(binary "$t")"
  else
    bg ${CXX:-clang++} "${flags[@]}" "$objs/$t.o" "${robjs[@]}" "${cobjs[@]}" "${libs[@]}" -o "$(binary "$t")"
  fi
done
if [[ "$(uname)" == "Darwin" ]]; then
  bg ${CXX:-clang++} "${flags[@]}" -fobjc-arc "$objs/objc_test.o" "${robjs[@]}" "${cobjs[@]}" "${libs[@]}" -framework Foundation -o "${out}_objc"
fi
drain

run_binary "$log" "$out"

# Lifetime scopes and one-shot operations, with their thread races.
run_binary "$log" "${out}_scope"

# Composing callbacks into promises and subscriptions: settled and cleaned
# up once, on their owner, whichever thread calls.
run_binary "$log" "${out}_callback"

# Resources: open, closing and closed, released once on their thread.
run_binary "$log" "${out}_resource"

# The app's and its scenes' lifecycle, as the platform reports it, and
# presentations that settle once however they end.
"${out}_lifecycle"

# Native extensions: handles destroyed once on their context, and checked
# conversions of what crosses into C.
"${out}_extension"

# Execution contexts: the legacy module context, the main context and
# isolated contexts, with what crosses between their threads.
run_binary "$log" "${out}_execution"

# Isolated compute: copying a task's input, the bounded pool and what
# crosses between it and the task's owner.
run_binary "$log" "${out}_compute"

# Native buffers: owned storage, borrows, transfer to tasks, and release on
# the executor the storage requires.
run_binary "$log" "${out}_buffer"

# BigInt, checked against the answers node gives for a seeded corpus.
run_binary "$log" "${out}_bigint" "${out}_bigint_corpus.txt"

# Number to string (String(x), toString(radix), toFixed, toExponential,
# toPrecision), checked against the strings node gives for a seeded corpus.
run_binary "$log" "${out}_number" "${out}_number_corpus.txt"

# The UI reactive graph: every scenario of a seeded corpus, checked against
# the log the JavaScript reference (reactive/reference.ts) gives.
run_binary "$log" "${out}_reactive" "${out}_reactive_corpus.txt"

# What compiled views share: the main context's graph, events' routes and
# where a view's errors go.
run_binary "$log" "${out}_view"

# Where the Android host finds each view's event emitter: by surface and
# tag (a tag alone is reused across runtimes), holding nothing alive.
run_binary "$log" "${out}_view_registry"

# How a component's host sizes to its content: the pixel grid, which
# measurements the shadow tree accepts, and when the host measures.
run_binary "$log" "${out}_sizing"

# Where a component lays out its React children: the slot's insets, which
# reports the shadow tree accepts, border edges, and when the host posts.
run_binary "$log" "${out}_slots"

# A toolkit body's list, by key: items found again by key, and keys that
# two items share (or NaN) refused.
run_binary "$log" "${out}_items"

# A native view's children that come and go: a keyed list reconciled
# against a recording backend (moves, item scopes, duplicate keys) and a
# conditional child.
run_binary "$log" "${out}_ui_children"

# The layout core: React Native's Yoga styled by its names, its leaves
# measured by a function, nested trees, right to left, pixel snapping.
run_binary "$log" "${out}_layout"

# What a debug build reports of the runtime: the live count of what it owns.
run_binary "$log" "${out}_debug"

# Requests Android answers later (activity results, permissions): settled
# once on the context that asked, forgotten on the platform when cancelled.
run_binary "$log" "${out}_android_requests"

# Native operations as promises: settled on their owner, cancelled by a
# signal or their scope, late results released.
"${out}_operation"

# Tracing: bounded, correlated events from the runtime's seams, and the
# three causes a trace tells apart (a queued job, a compute stall, a copy).
"${out}_trace"

# The Objective-C glue helpers, on the macOS host (ARC).
if [[ "$(uname)" == "Darwin" ]]; then
  run_binary "$log" "${out}_objc"
fi

# The UIKit glue compiles against the iOS simulator SDK, where there is one.
if [[ "$(uname)" == "Darwin" ]] && xcrun --sdk iphonesimulator --show-sdk-path >/dev/null 2>&1; then
  xcrun --sdk iphonesimulator clang++ -std=c++20 -ffp-contract=off -fobjc-arc -fsyntax-only -target arm64-apple-ios15.1-simulator \
    -Wall -Wextra -Wno-unused-parameter -Werror -I"$cpp" -x objective-c++ "$cpp/lucent/platform/ios_ui.mm" "$here/ios_ui_check.mm"
  echo "ios_ui: compiles against the iOS simulator SDK"
fi
