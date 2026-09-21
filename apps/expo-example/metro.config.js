const { getDefaultConfig } = require("expo/metro-config");
const { withLucent } = require("@lucent/metro");

module.exports = withLucent(getDefaultConfig(__dirname), { host: "expo" });
