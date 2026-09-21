# Getting started

Lucent needs a development build; Expo Go cannot load native modules.

## Expo (SDK 58)

```sh
npx expo install @lucent-lang/runtime @lucent-lang/types @lucent-lang/expo @lucent-lang/metro
```

```js
// metro.config.js
const { getDefaultConfig } = require("expo/metro-config");
const { withLucent } = require("@lucent-lang/metro");

module.exports = withLucent(getDefaultConfig(__dirname), { host: "expo" });
```

```json
// app.json
{ "expo": { "plugins": [["@lucent-lang/expo", { "host": "expo" }]] } }
```

Write a `*.lucent.ts` file, import it, then:

```sh
npx expo prebuild
npx expo run:ios   # or run:android
```

The plugin compiles your modules into `modules/lucent/`, which Expo autolinks.
Unchanged modules are cached between builds.

## Bare React Native (Nitro)

```sh
npm install @lucent-lang/runtime react-native-nitro-modules
npm install -D @lucent-lang/types @lucent-lang/metro @lucent-lang/cli nitrogen
```

```js
// metro.config.js
const { getDefaultConfig, mergeConfig } = require("@react-native/metro-config");
const { withLucent } = require("@lucent-lang/metro");

module.exports = withLucent(mergeConfig(getDefaultConfig(__dirname), {}), { host: "nitro" });
```

```js
// react-native.config.js
const path = require("path");
module.exports = {
  dependencies: { "lucent-native": { root: path.join(__dirname, ".lucent", "nitro") } },
};
```

```sh
npx lucent build --host nitro   # rerun whenever a *.lucent.ts file changes
cd ios && pod install && cd ..
npx react-native run-ios        # or run-android
```

## CLI

```
lucent build [--host expo|nitro] [--emit-ir] [--force] [files…]   compile and emit the native package
lucent check [files…]                                             type-check only
lucent init [--host expo|nitro]                                   wire a project's package.json
```

Next: [the language](language.md).
