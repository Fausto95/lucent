module.exports = {
  presets: ["module:@react-native/babel-preset"],
  // Reanimated's worklets (the Libraries screen), last as its plugin asks.
  plugins: ["react-native-worklets/plugin"],
};
