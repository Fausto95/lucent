# Sourced by the runtime test scripts: builds run side by side, at most one
# per core (LUCENT_TEST_JOBS to change it). `bg` starts one, waiting for the
# oldest when that many run, and `drain` waits for them all (a failed one
# fails the run). Bash 3.2, as macOS ships it, has no `wait -n`.
jobs_max="${LUCENT_TEST_JOBS:-$(getconf _NPROCESSORS_ONLN 2>/dev/null || echo 4)}"
pids=()
bg() {
  if ((${#pids[@]} >= jobs_max)); then
    wait "${pids[0]}"
    pids=(${pids[@]+"${pids[@]:1}"})
  fi
  "$@" &
  pids+=($!)
}
drain() {
  local pid
  for pid in ${pids[@]+"${pids[@]}"}; do wait "$pid"; done
  pids=()
}
