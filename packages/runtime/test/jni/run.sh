#!/usr/bin/env bash
# Builds and runs the JNI glue's tests (jni_test.cpp) on a desktop JVM: the
# runtime's platform/android.cpp built with LUCENT_JNI_HOST, and the desktop
# JNI host the compiler's JVM tests use (compiler/test/jni-host). Needs a
# JDK (JAVA_HOME, or the one javac belongs to); without one it says so and
# passes. The JVM runs with -Xcheck:jni: any warning it prints fails.
set -euo pipefail
here="$(cd "$(dirname "$0")" && pwd)"
cpp="$here/../../cpp"
host="$here/../../../compiler/test/jni-host"
out="${TMPDIR:-/tmp}/lucent-jni-test"
source "$here/../run_binary.sh"
source "$here/../parallel.sh"

jdk="${JAVA_HOME:-}"
if [[ -z "$jdk" ]] && command -v javac >/dev/null; then jdk="$(dirname "$(dirname "$(readlink -f "$(command -v javac)")")")"; fi
lib=$(find "$jdk/lib" -name 'libjvm.*' 2>/dev/null | head -1 || true)
if [[ -z "$jdk" || -z "$lib" ]]; then
  echo "jni: no JDK with a libjvm here: skipped"
  exit 0
fi
os=linux
[[ "$(uname)" == "Darwin" ]] && os=darwin

flags=(-std=c++20 -ffp-contract=off -g -O1 -Wall -Wextra -Wno-unused-parameter -I"$cpp" -I"$host" -I"$jdk/include" -I"$jdk/include/$os")
if [[ "${SANITIZE:-0}" == "1" ]]; then
  flags+=(-fsanitize=address,undefined -fno-omit-frame-pointer)
elif [[ "${SANITIZE:-0}" == "thread" ]]; then
  flags+=(-fsanitize=thread -fno-omit-frame-pointer)
fi
rm -rf "$out" && mkdir -p "$out/classes" "$out/objs"

# Lucent's Java classes the glue loads, beside the Android stand-ins they read.
javac --release 11 -d "$out/classes" $(find "$host/java" -name '*.java') "$here/../../native/android/src/main/java/dev/lucent/NativeProxy.java" 2> >(grep -v "^Picked up" >&2)

objs=()
for c in "$cpp"/third_party/quickjs/*.c; do
  o="$out/objs/$(basename "$c" .c).o"
  bg ${CC:-clang} -std=c11 -O2 -w $([[ "${SANITIZE:-0}" == "1" ]] && echo -fsanitize=address,undefined) $([[ "${SANITIZE:-0}" == "thread" ]] && echo -fsanitize=thread) -c "$c" -o "$o"
  objs+=("$o")
done
for f in "$cpp"/lucent/*.cpp "$cpp/lucent/platform/android.cpp" "$host/jni_host.cpp" "$here/jni_test.cpp"; do
  o="$out/objs/$(basename "$f" .cpp).o"
  [[ "$f" == */platform/android.cpp ]] && o="$out/objs/platform_android.o"
  bg ${CXX:-clang++} "${flags[@]}" -DLUCENT_JNI_HOST -c "$f" -o "$o"
  objs+=("$o")
done
drain

${CXX:-clang++} "${flags[@]}" "${objs[@]}" -L"$(dirname "$lib")" -ljvm -Wl,-rpath,"$(dirname "$lib")" -lpthread \
  $([[ "$(uname)" == "Darwin" ]] && echo -framework CoreFoundation) -o "$out/jni_test"

log="${out}_output.log"
run_binary "$log" "$out/jni_test" "$out/classes"
if grep -q "^WARNING" "$log"; then
  echo "jni: the JVM's JNI checks warned" >&2
  exit 1
fi
