const path = require("path");

module.exports = {
  dependencies: {
    // The native package `lucent build` generates (C++ runtime + compiled modules).
    "lucent-native": {
      root: path.join(__dirname, ".lucent", "native"),
    },
  },
};
