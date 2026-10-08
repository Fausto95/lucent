"use strict";
// Metro babel transformer: bundles each *.lucent.ts module as a require of its JS proxy.
const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const { nativePackage } = require("./native-package.cjs");
const jsDev = require("./js-dev.cjs");

const upstream = require(process.env.LUCENT_UPSTREAM_TRANSFORMER);
const LUCENT = /\.lucent\.tsx?$/;

/**
 * The Lucent package a file belongs to, as the compiler's lucentPackageOf
 * finds it: the nearest package.json with a name or dependencies, if it has
 * a `lucent` field.
 */
function lucentPackageOf(filename) {
  for (let dir = path.dirname(path.resolve(filename)); ; dir = path.dirname(dir)) {
    const file = path.join(dir, "package.json");
    const pkg = fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, "utf8")) : undefined;
    if (pkg && (pkg.name || pkg.dependencies)) {
      if (!pkg.lucent || !pkg.name) return undefined;
      return { name: pkg.name, sources: path.join(dir, pkg.lucent.sources || ".") };
    }
    if (path.dirname(dir) === dir) return undefined;
  }
}

/**
 * The module's name, as the compiler's moduleNameOf gives it: its file's, or
 * in Lucent package `pkg` `<package>/<path under its sources>`.
 */
function moduleName(filename, pkg) {
  const base = (f) => f.replace(/\.(ios|android)(?=\.lucent\.tsx?$)/, "").replace(LUCENT, "");
  if (!pkg) return base(path.basename(filename));
  const rel = path.relative(pkg.sources, path.resolve(filename));
  return `${pkg.name}/${base(rel).split(path.sep).join("/")}`;
}

/**
 * The module as Metro bundles it: a require of its proxy, a module of its
 * own, so Metro watches it and serves what the last build wrote. A module
 * not compiled yet fails the transform, which Metro retries on the next
 * request, rather than bundling a throw it would keep until a restart.
 */
function proxyFor(filename, projectRoot) {
  // Metro passes the file's path relative to the project.
  const file = path.resolve(projectRoot, filename);
  const pkg = lucentPackageOf(file);
  const generated = path.join(nativePackage(projectRoot), "js", `${moduleName(file, pkg)}.js`);
  if (!fs.existsSync(generated)) {
    const why = pkg ? ` (lucent build compiles ${pkg.name} only when the app depends on it)` : "";
    throw new Error(
      `Lucent: ${path.basename(file)} has not been compiled. Run \`lucent build\` and rebuild the app${why}.`,
    );
  }

  const rel = path.relative(path.dirname(file), generated).split(path.sep).join("/");
  return `module.exports = require(${JSON.stringify(rel.startsWith(".") ? rel : `./${rel}`)});\n`;
}

/** The file's content hash, as the build records it (src/cli/problems.ts). */
const hashOf = (text) => crypto.createHash("sha256").update(text).digest("hex").slice(0, 16);

/** `file`'s realpath, or `file` if it does not exist. */
function realpath(file) {
  try {
    return fs.realpathSync(file);
  } catch {
    return file;
  }
}

/** The last build's problems for `file` (absolute), as `lucent build` printed them: { hash, text }. */
function problemsOf(projectRoot, file) {
  try {
    const record = JSON.parse(
      fs.readFileSync(path.join(projectRoot, ".lucent", "problems.json"), "utf8"),
    );
    if (!record.files) return undefined;
    // The build records realpaths (the CLI resolves --root); Metro's projectRoot may be a
    // symlink to the project, as macOS's temporary directory is.
    return record.files[file] || record.files[realpath(file)];
  } catch {
    return undefined;
  }
}

/** How long a transform waits for the build of an edit the last build's problems predate. */
const PENDING_MS = Number(process.env.LUCENT_TRANSFORM_WAIT_MS || 5000);

/**
 * Fails the transform with the last build's diagnostics for this module
 * (their code frames), which Metro shows in the app's RedBox: the
 * module's last build failed. Problems recorded for other content than
 * Metro's (an edit the watcher is building) are waited for, until the
 * build records this content's problems, or none: a transform that
 * succeeded meanwhile would be cached for this content and hide them.
 */
function failOnProblems(projectRoot, file, src) {
  const hash = hashOf(src);
  const sleeper = new Int32Array(new SharedArrayBuffer(4));
  for (const start = Date.now(); ;) {
    const p = problemsOf(projectRoot, file);
    if (!p) return;
    if (p.hash === hash) {
      const error = new Error(`Lucent: ${path.basename(file)} does not compile\n\n${p.text}`);
      // Metro shows a transform error's message and code frame; this one is ours.
      error.filename = file;
      throw error;
    }
    if (Date.now() - start > PENDING_MS) return;
    Atomics.wait(sleeper, 0, 0, 50);
  }
}

/** The module names the native package's manifest lists, which name each module's proxy. */
function moduleNames(pkg) {
  try {
    return JSON.parse(fs.readFileSync(path.join(pkg, "manifest.json"), "utf8")).modules || [];
  } catch {
    return [];
  }
}

module.exports = {
  ...upstream,
  transform(args) {
    if (LUCENT.test(args.filename)) {
      const root = (args.options && args.options.projectRoot) || process.cwd();
      const file = path.resolve(root, args.filename);
      failOnProblems(root, file, args.src);
      const src = jsDev.enabled()
        ? jsDev.module(file, args, () => proxyFor(file, root))
        : undefined;
      // The proxy is plain JavaScript, which the TypeScript pipeline accepts.
      return upstream.transform({ ...args, src: src ?? proxyFor(args.filename, root) });
    }
    return upstream.transform(args);
  },
  getCacheKey(options, ...rest) {
    const base =
      typeof upstream.getCacheKey === "function" ? upstream.getCacheKey(options, ...rest) : "";
    // A module's output is a require of its proxy: it depends on where the
    // package is and which modules it has, not on what a build wrote.
    const pkg = nativePackage((options && options.projectRoot) || process.cwd());
    return crypto
      .createHash("sha1")
      .update(base)
      .update(JSON.stringify([pkg, moduleNames(pkg), jsDev.enabled()]))
      .update("lucent-3")
      .digest("hex");
  },
};
