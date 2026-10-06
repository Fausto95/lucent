"use strict";
// Metro babel transformer: swaps each *.lucent.ts module for its JS proxy.
const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const { nativePackage } = require("./native-package.cjs");

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

function proxyFor(filename, projectRoot) {
  const pkg = lucentPackageOf(filename);
  const generated = path.join(nativePackage(projectRoot), "js", `${moduleName(filename, pkg)}.js`);
  if (fs.existsSync(generated))
    return rebase(fs.readFileSync(generated, "utf8"), generated, filename);
  const why = pkg ? ` (lucent build compiles ${pkg.name} only when the app depends on it)` : "";
  return `throw new Error(${JSON.stringify(`Lucent: ${path.basename(filename)} has not been compiled. Run \`lucent build\` and rebuild the app${why}.`)});\n`;
}

/**
 * The proxy's relative requires (the JS loader), which are relative to the
 * generated file, made relative to the source file Metro bundles it as.
 */
function rebase(proxy, generated, filename) {
  return proxy.replace(/require\("(\.\.?\/[^"]+)"\)/g, (_, spec) => {
    const rel = path
      .relative(path.dirname(filename), path.resolve(path.dirname(generated), spec))
      .split(path.sep)
      .join("/");
    return `require(${JSON.stringify(rel.startsWith(".") ? rel : `./${rel}`)})`;
  });
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
  getCacheKey(...args) {
    const base = typeof upstream.getCacheKey === "function" ? upstream.getCacheKey(...args) : "";
    // Proxies change when `lucent build` runs: include the manifest in the key.
    const manifest = path.join(nativePackage(process.cwd()), "manifest.json");
    const stamp = fs.existsSync(manifest) ? fs.readFileSync(manifest, "utf8") : "";
    return crypto.createHash("sha1").update(base).update(stamp).update("lucent-1").digest("hex");
  },
};
