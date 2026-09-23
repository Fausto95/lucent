"use strict";
// Metro integration. `*.lucent.ts` files stay the source of truth for types;
// when bundling, their contents are replaced by the generated JS proxy that
// forwards to the native module (written by `lucent build`).
const path = require("node:path");
const { spawn } = require("node:child_process");

/**
 * Wraps a Metro config:
 *   module.exports = withLucent(getDefaultConfig(__dirname));
 *
 * When Metro runs as a dev server, a `lucent build --watch` process keeps
 * `.lucent/native` up to date while you edit *.lucent.ts files. Set
 * `{ watch: false }` or LUCENT_WATCH=0 to turn that off (LUCENT_WATCH=1 forces it).
 */
function withLucent(config, options = {}) {
  if (shouldWatch(options)) startWatcher(config.projectRoot || process.cwd());
  const upstream = (config.transformer && config.transformer.babelTransformerPath) || defaultTransformer();
  // Transformer workers inherit the environment.
  process.env.LUCENT_UPSTREAM_TRANSFORMER = upstream;
  return {
    ...config,
    transformer: {
      ...config.transformer,
      babelTransformerPath: path.join(__dirname, "transformer.cjs"),
    },
  };
}

function defaultTransformer() {
  for (const candidate of ["@react-native/metro-babel-transformer", "@expo/metro-config/babel-transformer"]) {
    try {
      return require.resolve(candidate, { paths: [process.cwd()] });
    } catch {
      // try the next one
    }
  }
  throw new Error("Lucent: could not find Metro's babel transformer; set transformer.babelTransformerPath first");
}

function shouldWatch(options) {
  if (options.watch !== undefined) return options.watch;
  if (process.env.LUCENT_WATCH === "0") return false;
  if (process.env.LUCENT_WATCH === "1") return true;
  // Dev servers: `react-native start`, `expo start`, `expo run:ios|android`.
  return process.argv.some((a) => a === "start" || a === "run:ios" || a === "run:android");
}

let watcher;

function startWatcher(root) {
  // Metro may load the config more than once in a process.
  if (watcher || process.env.LUCENT_WATCH_CHILD) return;
  let bin;
  try {
    bin = require.resolve("@lucent-lang/cli/bin/lucent.cjs", { paths: [root, __dirname] });
  } catch {
    console.warn("Lucent: @lucent-lang/cli is not installed; run `lucent build` yourself after editing *.lucent.ts files");
    return;
  }
  watcher = spawn(process.execPath, [bin, "build", "--watch", "--root", root], { stdio: "inherit", env: { ...process.env, LUCENT_WATCH_CHILD: "1" } });
  // Ctrl-C reaches the watcher through the process group; this covers the rest.
  process.on("exit", () => watcher.kill());
}

module.exports = { withLucent };
