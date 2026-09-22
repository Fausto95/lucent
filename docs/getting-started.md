# Getting started

Lucent needs a development build; Expo Go cannot load native modules.

## Quick start

```sh
npx @lucent-lang/cli init     # detects Expo or bare React Native and wires the app
npx @lucent-lang/cli doctor   # verifies the toolchain and the wiring
```

`init` adds the dependencies, `lucent.config.ts`, a Metro config (or tells you
what to add to yours), the Expo plugin or the Nitro autolink entry, and a
starter `src/math.lucent.ts`. The sections below show what it produces, for
when you would rather wire things by hand.

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
npx lucent build --host nitro   # or `lucent build --watch` while you work
cd ios && pod install && cd ..
npx react-native run-ios        # or run-android
```

## CLI

`npx @lucent-lang/cli <command>` runs the latest release without installing
anything. Inside a project that lists `@lucent-lang/cli`, `npx lucent <command>`
runs the local copy. The host is detected from `package.json`
(`react-native-nitro-modules` means Nitro, `expo` means Expo); `--host` overrides it.

```
lucent init [--host expo|nitro] [--yes]              wire an app: dependencies, config, Metro, plugin, starter
lucent build [--watch] [--emit-ir] [--force] [files…] compile and emit the native package
lucent check [--watch] [files…]                      type-check only
lucent doctor                                        check the toolchain and the project wiring
lucent explain [code]                                describe a diagnostic code, or list them all
lucent ir <file>                                     print a module's intermediate representation
lucent clean [--dry-run]                             remove the cache and the generated package
lucent sdk swift|android …                           extract bindings from platform SDKs
```

Every command accepts `--help`. Global flags: `--json` for machine-readable
output, `--quiet`, `--no-color` (`NO_COLOR` and `FORCE_COLOR` are honored) and
`--no-emoji` (`NO_EMOJI` too). Mistyped commands and flags get a suggestion.

Next: [the language](language.md).
