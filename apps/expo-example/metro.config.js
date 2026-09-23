const { getDefaultConfig } = require("expo/metro-config");
const { withLucent } = require("@lucent-lang/metro");

module.exports = withLucent(getDefaultConfig(__dirname));
