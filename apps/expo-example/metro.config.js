const { getDefaultConfig } = require("expo/metro-config");
const { withLucent } = require("@lucent-lang/lucent/metro");

module.exports = withLucent(getDefaultConfig(__dirname));
