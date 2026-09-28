#!/usr/bin/env bash
# Checks run_binary.sh, which the runtime test scripts run each test binary
# through: a binary fails on its exit status, and on any sanitizer report
# it prints, even when it exits 0.
set -euo pipefail
here="$(cd "$(dirname "$0")" && pwd)"
source "$here/run_binary.sh"

work="$(mktemp -d "${TMPDIR:-/tmp}/lucent-run-binary-test.XXXXXX")"
trap 'rm -rf "$work"' EXIT

failures=0

# A fake test binary that prints `$1` on stderr, then exits with `$2`.
fake() {
  local path="$work/$3"

  printf '#!/usr/bin/env bash\nprintf "%%s\\n" "%s" >&2\nexit %s\n' "$1" "$2" > "$path"
  chmod +x "$path"
  echo "$path"
}

# Expects run_binary to end with `$1` for the fake binary `$2`.
expect() {
  local want="$1"
  local got=0

  (run_binary "$work/output.log" "$2") > /dev/null 2>&1 || got=$?

  if [[ "$want" == "fail" && "$got" == 0 ]] || [[ "$want" != "fail" && "$got" != "$want" ]]; then
    echo "run_binary_test: $(basename "$2") ended with $got, expected $want" >&2
    failures=$((failures + 1))
  fi
}

expect 0 "$(fake "compute: 3 checks, 0 failures" 0 clean)"
expect 3 "$(fake "compute: 3 checks, 1 failures" 3 failing)"

# Reports from another thread, cut short by the process exiting with 0.
expect fail "$(fake "==1==ERROR: AddressSanitizer: stack-use-after-scope on address 0x1" 0 asan)"
expect fail "$(fake "==1==ERROR: LeakSanitizer: detected memory leaks" 0 lsan)"
expect fail "$(fake "WARNING: ThreadSanitizer: data race (pid=1)" 0 tsan)"
expect fail "$(fake "compute_test.cpp:1:2: runtime error: signed integer overflow" 0 ubsan)"

# The binary's output still reaches the caller.
if ! run_binary "$work/output.log" "$(fake "visible" 0 visible)" 2>&1 | grep -q visible; then
  echo "run_binary_test: the binary's output was not passed through" >&2
  failures=$((failures + 1))
fi

if ((failures > 0)); then
  echo "run_binary_test: $failures failures" >&2
  exit 1
fi

echo "run_binary: 7 checks, 0 failures"
