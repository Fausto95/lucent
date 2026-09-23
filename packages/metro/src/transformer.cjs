"use strict";
// Metro babel transformer: swaps each *.lucent.ts module for its JS proxy.
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

function proxyFor(filename, projectRoot) {
  const name = moduleName(filename);
  const generated = path.join(projectRoot, ".lucent", "native", "js", `${name}.js`);
  if (fs.existsSync(generated)) return fs.readFileSync(generated, "utf8");
  return (
    `throw new Error(${JSON.stringify(`Lucent: ${path.basename(filename)} has not been compiled. Run \`lucent build\` and rebuild the app.`)});\n`
  );
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
    const manifest = path.join(process.cwd(), ".lucent", "native", "manifest.json");
    const stamp = fs.existsSync(manifest) ? fs.readFileSync(manifest, "utf8") : "";
    return crypto.createHash("sha1").update(base).update(stamp).update("lucent-1").digest("hex");
  },
};
