# Sourced by every `run:` step's bash through BASH_ENV (set in the workflows). When the step fails,
# it reports the end of the step's output as an error annotation, so a failure shows on the pull
# request (and through the checks API) without opening the job's log.
if [ -z "${LUCENT_CI_TRAP:-}" ] && [ -n "${GITHUB_ACTIONS:-}" ]; then
  export LUCENT_CI_TRAP=1
  __lucent_log="$(mktemp)"
  exec 3>&1 4>&2
  exec > >(tee -a "$__lucent_log") 2>&1
  __lucent_report() {
    local code=$?
    if [ "$code" -ne 0 ]; then
      exec 1>&3 2>&4
      sleep 0.3
      local text
      text="$(sed -e 's/\x1b\[[0-9;]*[A-Za-z]//g' "$__lucent_log" | grep -v '^::' | tail -n 120)"
      text="${text//'%'/'%25'}"
      text="${text//$'\r'/'%0D'}"
      text="${text//$'\n'/'%0A'}"
      echo "::error title=${GITHUB_JOB:-step} failed (exit $code)::${text}"
    fi
    return "$code"
  }
  trap __lucent_report EXIT
fi
