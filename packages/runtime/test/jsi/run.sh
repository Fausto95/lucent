#!/usr/bin/env bash
# Builds and runs the JSI tests in Hermes: the host's lifetime across
# runtimes (host_test.cpp), the hand-written module through the harness
# (manual.test.js), and the JS loader's check of it (identity.test.js).
# Needs HERMES_DIR, as build.sh does; SANITIZE=1 adds ASan and UBSan,
# SANITIZE=thread adds TSan.
set -euo pipefail
here="$(cd "$(dirname "$0")" && pwd)"
out="${TMPDIR:-/tmp}/lucent-jsi-test"
source "$here/../run_binary.sh"
log="${out}_output.log"

HARNESS=0 "$here/build.sh" "${out}_host" "$here/host_test.cpp" "$here/../../cpp/rn/LucentViewRequests.cpp"
run_binary "$log" "${out}_host"

"$here/build.sh" "${out}_manual" "$here/manual_module.cpp"
run_binary "$log" "${out}_manual" "$here/abort-polyfill.js" "$here/manual.test.js"

# The JS loader's check of the native build identity, against a real host.
run_binary "$log" "${out}_manual" "$here/commonjs.js" "$here/../../js/index.js" "$here/identity.test.js"
