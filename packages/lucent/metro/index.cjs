"use strict";
// Metro integration. `*.lucent.ts` files stay the source of truth for types;
// when bundling, each becomes a require of the generated JS proxy that
// forwards to the native module (written by `lucent build`).
const fs = require("node:fs");
const path = require("node:path");
const { spawn } = require("node:child_process");
const { nativePackage } = require("./native-package.cjs");
const web = require("./web.cjs");

/**
 * Wraps a Metro config:
 *   module.exports = withLucent(getDefaultConfig(__dirname));
 *
 * When Metro runs as a dev server, `lucent dev --compact` keeps
 * `.lucent/native` up to date while you edit *.lucent.ts files, one line
 * per build in Metro's output (it never reads Metro's keys; for the full
 * dashboard, run `lucent dev` in a terminal of its own). Set
 * `{ watch: false }` or LUCENT_WATCH=0 to turn that off (LUCENT_WATCH=1 forces it).
 *
 * `{ js: true }` (or LUCENT_JS=1) is JS dev mode: Metro bundles each module
 * as its JavaScript, so edits refresh without a native rebuild, and
 * platform SDK calls throw (js-dev.cjs). Development builds only.
 *
 * For the web, Metro bundles each module as its JavaScript, and resolves a
 * module to its web twin, m.web.lucent.ts, when it has one (web.cjs).
 */
function withLucent(config, options = {}) {
  const root = config.projectRoot || process.cwd();
  // Metro watches the proxies' directory from its start: made later, by the
  // first build while Metro runs, its watcher can miss the proxy renamed
  // into it and serve "has not been compiled" until a restart.
  try {
    fs.mkdirSync(path.join(nativePackage(root), "js"), { recursive: true });
  } catch {
    // A read-only project: the build makes it.
  }
  if (shouldWatch(options)) startWatcher(root);
  // JS dev mode (metro/js-dev.cjs): modules run as JavaScript. Transformer workers inherit it.
  const js = options.js ?? process.env.LUCENT_JS === "1";
  process.env.LUCENT_JS_DEV = js ? "1" : "0";
  if (js && !jsDevNoted) {
    jsDevNoted = true;
    process.stderr.write(
      "Lucent: JS dev mode: *.lucent.ts modules run as JavaScript (edits refresh without a native rebuild); platform SDK calls throw LUCENT_JS_DEV_NATIVE. Development only.\n",
    );
  }
  const upstream =
    (config.transformer && config.transformer.babelTransformerPath) || defaultTransformer();
  // Transformer workers inherit the environment.
  process.env.LUCENT_UPSTREAM_TRANSFORMER = upstream;
  // A proxy's packages (react-native) are the app's, wherever the native
  // package is: LUCENT_OUT may name a directory outside the app.
  const resolver = config.resolver || {};
  const appModules = path.join(root, "node_modules");
  const nodeModulesPaths = resolver.nodeModulesPaths || [];
  return {
    ...config,
    resolver: {
      ...resolver,
      nodeModulesPaths: nodeModulesPaths.includes(appModules)
        ? nodeModulesPaths
        : [...nodeModulesPaths, appModules],
      // A component's React types are lucent:views/<module> (tsconfig's lucent:* path);
      // `lucent build` writes, under that name, a module that requires the component's own.
      // The app's map stays the prototype: a Proxy's get trap keeps answering for the rest.
      extraNodeModules: Object.assign(Object.create(resolver.extraNodeModules || null), {
        "lucent:views": path.join(nativePackage(root), "js/_lucent/components"),
      }),
      resolveRequest: webResolver(resolver.resolveRequest),
    },
    transformer: {
      ...config.transformer,
      babelTransformerPath: path.join(__dirname, "transformer.cjs"),
    },
  };
}

/**
 * The app's resolver (`upstream`, else Metro's own), with the web's rules
 * (decision 0133): a module resolves to its web twin when it has one, and a component's
 * `lucent:views/*` fails, its views being native.
 */
function webResolver(upstream) {
  return (context, moduleName, platform) => {
    const resolve = upstream || context.resolveRequest;
    if (platform !== "web") return resolve(context, moduleName, platform);

    if (moduleName.startsWith("lucent:views/"))
      throw new Error(
        `Lucent: ${moduleName} is a component, whose views are native: the web has none. Render a React component on the web instead, in a .web.tsx file beside the code that imports it.`,
      );
    const found = resolve(context, moduleName, platform);
    const twin = found && found.type === "sourceFile" ? web.webTwin(found.filePath) : undefined;
    return twin ? { type: "sourceFile", filePath: twin } : found;
  };
}

function defaultTransformer() {
  for (const candidate of [
    "@react-native/metro-babel-transformer",
    "@expo/metro-config/babel-transformer",
  ]) {
    try {
      return require.resolve(candidate, { paths: [process.cwd()] });
    } catch {
      // try the next one
    }
  }
  throw new Error(
    "Lucent: could not find Metro's babel transformer; set transformer.babelTransformerPath first",
  );
}

function shouldWatch(options) {
  if (options.watch !== undefined) return options.watch;
  if (process.env.LUCENT_WATCH === "0") return false;
  if (process.env.LUCENT_WATCH === "1") return true;
  // Dev servers: `react-native start`, `expo start`, `expo run:ios|android`.
  return process.argv.some((a) => a === "start" || a === "run:ios" || a === "run:android");
}

let watcher;
let jsDevNoted = false;

function startWatcher(root) {
  // Metro may load the config more than once in a process.
  if (watcher || process.env.LUCENT_WATCH_CHILD) return;
  const bin = path.join(__dirname, "../bin/lucent.cjs");
  // stdin stays Metro's: its keys (r reload, d dev menu) are not ours.
  watcher = spawn(process.execPath, [bin, "dev", "--compact", "--root", root], {
    stdio: ["ignore", "inherit", "inherit"],
    env: { ...process.env, LUCENT_WATCH_CHILD: "1" },
  });
  // Ctrl-C reaches the watcher through the process group; this covers the rest.
  process.on("exit", () => watcher.kill());
}

module.exports = { withLucent };
