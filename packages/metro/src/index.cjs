"use strict";
// Metro integration. `*.lucent.ts` files stay the source of truth for types;
// when bundling, their contents are replaced by the generated JS proxy that
// forwards to the native module (written by `lucent build`).
const path = require("node:path");

/**
 * Wraps a Metro config:
 *   module.exports = withLucent(getDefaultConfig(__dirname));
 */
function withLucent(config) {
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

module.exports = { withLucent };
