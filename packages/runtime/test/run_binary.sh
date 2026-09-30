# Sourced by the runtime test scripts. Checked by run_binary_test.sh.

# Sanitizer reports: ASan, LSan, TSan, and UBSan's diagnostics.
sanitizer_reports='ERROR: (Address|Leak)Sanitizer|WARNING: ThreadSanitizer|runtime error:'

# Runs a test binary, its output going through to the caller and into the
# log `$1`. It fails on the binary's exit status, and on any sanitizer
# report in its output: a report from another thread can be cut short by
# the process exiting, with status 0.
run_binary() {
  local log="$1"
  local status=0
  shift

  "$@" 2>&1 | tee "$log" || status=$?

  if ((status != 0)); then
    echo "run_binary: $(basename "$1") failed with status $status" >&2
    return "$status"
  fi

  if grep -Eq "$sanitizer_reports" "$log"; then
    echo "run_binary: $(basename "$1") printed a sanitizer report" >&2
    return 1
  fi
}
