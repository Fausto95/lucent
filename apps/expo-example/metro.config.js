const { getDefaultConfig } = require("expo/metro-config");
const { withLucent } = require("@lucent-lang/core/metro");

module.exports = withLucent(getDefaultConfig(__dirname), { host: "expo" });
