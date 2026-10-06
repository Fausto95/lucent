"use strict";
// Metro babel transformer: bundles each *.lucent.ts module as a require of its JS proxy.
const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");

const upstream = require(process.env.LUCENT_UPSTREAM_TRANSFORMER);
const LUCENT = /\.lucent\.tsx?$/;

/**
 * The module's name, as the compiler's moduleNameOf gives it: its file's, or
 * in a Lucent package (the nearest package.json has a `lucent` field)
 * `<package>/<path under its sources>`.
 */
function moduleName(filename) {
  const base = (f) => f.replace(/\.(ios|android)(?=\.lucent\.tsx?$)/, "").replace(LUCENT, "");
  for (let dir = path.dirname(path.resolve(filename)); ; dir = path.dirname(dir)) {
    const file = path.join(dir, "package.json");
    if (fs.existsSync(file)) {
      const pkg = JSON.parse(fs.readFileSync(file, "utf8"));
      if (!pkg.lucent || !pkg.name) break;
      const rel = path.relative(path.join(dir, pkg.lucent.sources || "."), path.resolve(filename));
      return `${pkg.name}/${base(rel).split(path.sep).join("/")}`;
    }
    if (path.dirname(dir) === dir) break;
  }
  return base(path.basename(filename));
}

/**
 * The native package whose proxies Metro bundles: the project's
 * .lucent/native, or the one LUCENT_OUT names (as `lucent build --out`,
 * relative to the project).
 */
function nativePackage(projectRoot) {
  return path.resolve(projectRoot, process.env.LUCENT_OUT || path.join(".lucent", "native"));
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
  const generated = path.join(nativePackage(projectRoot), "js", `${moduleName(file)}.js`);
  if (!fs.existsSync(generated))
    throw new Error(
      `Lucent: ${path.basename(file)} has not been compiled. Run \`lucent build\` and rebuild the app.`,
    );

  const rel = path.relative(path.dirname(file), generated).split(path.sep).join("/");
  return `module.exports = require(${JSON.stringify(rel.startsWith(".") ? rel : `./${rel}`)});\n`;
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
      const src = proxyFor(args.filename, root);
      // The proxy is plain JavaScript, which the TypeScript pipeline accepts.
      return upstream.transform({ ...args, src });
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
      .update(JSON.stringify([pkg, moduleNames(pkg)]))
      .update("lucent-2")
      .digest("hex");
  },
};
