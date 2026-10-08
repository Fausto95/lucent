/**
 * A stand-in for Xcode's tools on any machine: an `xcrun` that reports an
 * empty simulator SDK, writes symbol graphs from a checked-in fixture
 * (fixtures/swift-graphs/template.symbols.json, one Swift class `Gauge`,
 * named for the module asked for), and records what `swiftc` was asked
 * to emit, making the module it would. What
 * the provider does with Xcode's outputs is tested here; Xcode's own
 * behavior (that the flags build what they should) is not.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const template = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  "fixtures/swift-graphs/template.symbols.json",
);

export interface FakeXcode {
  xcrun: string;
  /** Each call, one line: the tool and its arguments. */
  calls: () => string[];
}

/**
 * Writes the tools into `dir`. `swiftc -emit-module-path <p>` makes `<p>`;
 * a module whose name starts with `Broken` fails to build or extract.
 */
export function fakeXcode(dir: string): FakeXcode {
  fs.mkdirSync(path.join(dir, "sdk/System/Library/Frameworks"), { recursive: true });
  const log = path.join(dir, "calls.log");
  const xcrun = path.join(dir, "xcrun");
  fs.writeFileSync(
    xcrun,
    `#!/bin/sh
case "$*" in
  *--show-sdk-path*) echo "${dir}/sdk"; exit 0 ;;
  *--show-sdk-version*) echo 27.0; exit 0 ;;
  *--show-sdk-build-version*) echo 27A1; exit 0 ;;
esac
tool="$1"; shift
echo "$tool $*" >> "${log}"
case "$tool" in
  swift-symbolgraph-extract)
    while [ $# -gt 0 ]; do
      case "$1" in -module-name) m="$2"; shift ;; -output-dir) out="$2"; shift ;; esac
      shift
    done
    case "$m" in Broken*) echo "error: no such module '$m'" >&2; exit 1 ;; esac
    sed -e "s/__LEN__/\${#m}/g" -e "s/__MODULE__/$m/g" "${template}" > "$out/$m.symbols.json" ;;
  swiftc)
    while [ $# -gt 0 ]; do
      case "$1" in -emit-module-path) p="$2"; shift ;; -module-name) m="$2"; shift ;; esac
      shift
    done
    case "$m" in Broken*) echo "error: cannot compile $m" >&2; exit 1 ;; esac
    mkdir -p "$p" ;;
  *) echo "fake xcrun: $tool" >&2; exit 1 ;;
esac
`,
    { mode: 0o755 },
  );

  return {
    xcrun,
    calls: () =>
      fs.existsSync(log) ? fs.readFileSync(log, "utf8").trim().split("\n").filter(Boolean) : [],
  };
}
