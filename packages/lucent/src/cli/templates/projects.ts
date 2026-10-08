/**
 * What `lucent create` scaffolds: a bare React Native app, an Expo app
 * (a development build) or a Lucent library package, each with sample
 * modules, set up for Lucent as `lucent init --yes` sets an app up. Every
 * file comes from this package: the bare app's native projects are React
 * Native's community template (templates/bare, its MIT licence beside it),
 * the rest is written here. Nothing is fetched but what the package
 * manager installs.
 */
import fs from "node:fs";
import path from "node:path";
import { applyChanges, planInit } from "../init/plan.ts";
import { packageFile, version } from "../version.ts";
import { platformSource, starterModule } from "./modules.ts";

export const PROJECT_TEMPLATES = ["expo", "bare", "view", "library", "module"] as const;
export type ProjectTemplate = (typeof PROJECT_TEMPLATES)[number];

export const PROJECT_TEMPLATE_SUMMARIES: Record<ProjectTemplate, string> = {
  expo: "an Expo app, run as a development build (expo run:ios, EAS)",
  bare: "a bare React Native app, with its ios/ and android/ projects",
  view: "an Expo app whose screen renders a native view written in Lucent",
  library: "a Lucent package to publish to npm, with an example app",
  module: "modules alone, no app: try the language with lucent build and lucent bench",
};

/**
 * The versions the templates pin, as the bare template and Expo SDK 58
 * pair them (the example apps' versions).
 */
const VERSIONS = {
  react: "19.3.0",
  reactNative: "0.88.0-rc.2",
  rnTooling: "0.88.0-rc.2",
  rnCli: "20.2.0",
  expo: "~58.0.6",
  expoReactNative: "0.88.0-rc.3",
  expoDevClient: "~58.0.11",
  expoStatusBar: "~58.0.3",
  typesReact: "^19.2.0",
  typescript: "~5.9.3",
};

/** `my-app` → `MyApp`: the app's name where React Native needs letters and digits. */
export function appName(name: string): string {
  const pascal = path
    .basename(name)
    .replace(/(^|[^A-Za-z0-9]+)([A-Za-z0-9])/g, (_, _s, c: string) => c.toUpperCase())
    .replace(/[^A-Za-z0-9]/g, "");
  return /^[A-Za-z]/.test(pascal) ? pascal : `App${pascal}`;
}

/** The npm package name for a directory name: lower case, `-` for anything npm refuses. */
export function packageName(name: string): string {
  const base = path.basename(name);
  if (/^@[a-z0-9-~][a-z0-9-._~]*\/[a-z0-9-~][a-z0-9-._~]*$/.test(name)) return name;
  return (
    base
      .toLowerCase()
      .replace(/[^a-z0-9-._~]+/g, "-")
      .replace(/^[-._]+|[-._]+$/g, "") || "app"
  );
}

/** The range apps and libraries depend on Lucent with: this version's caret range. */
const lucentRange = () => `^${version()}`;

const json = (value: unknown) => `${JSON.stringify(value, null, 2)}\n`;

/** The App.tsx of the apps: calls each sample module and shows what it returned. */
const APP = (title: string) => `import { useEffect, useState } from "react";
import { SafeAreaView, StyleSheet, Text } from "react-native";
import { hello } from "./src/hello.lucent";
import { greeting } from "./src/device.lucent";

export default function App() {
  const [device, setDevice] = useState("…");

  useEffect(() => {
    greeting("${title}").then(setDevice, (e: Error) => setDevice(e.message));
  }, []);

  return (
    <SafeAreaView style={styles.screen}>
      {/* Native code, called synchronously. */}
      <Text style={styles.line}>{hello("Lucent")}</Text>
      {/* Native code calling each platform's SDK. */}
      <Text style={styles.line}>{device}</Text>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, alignItems: "center", justifyContent: "center" },
  line: { fontSize: 18, margin: 8 },
});
`;

/** The view template's App.tsx: renders the Lucent component, updating its prop. */
const VIEW_APP = `import { useState } from "react";
import { Button, SafeAreaView, StyleSheet } from "react-native";
import { Badge } from "./src/badge.lucent";
import { hello } from "./src/hello.lucent";

export default function App() {
  const [count, setCount] = useState(0);

  return (
    <SafeAreaView style={styles.screen}>
      {/* A UILabel on iOS, a TextView on Android: native views, made by src/badge.lucent.tsx. */}
      <Badge label={\`\${hello("Lucent")} · \${count}\`} style={styles.badge} />
      <Button title="Count" onPress={() => setCount((n) => n + 1)} />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, alignItems: "center", justifyContent: "center" },
  badge: { width: 280, height: 44 },
});
`;

/** The apps' sample modules: hello (shared) and device (each platform's SDK). */
const appModules = (): Record<string, string> => ({
  ...starterModule("function", "hello").files,
  "src/device.lucent.ts": platformSource("device", ["ios", "android"], "greeting"),
});

const README = (title: string, run: string[], extra = "") => `# ${title}

A React Native app with native modules written in TypeScript with [Lucent](https://lucent-lang.dev).

\`\`\`sh
${run.join("\n")}
\`\`\`

- \`src/hello.lucent.ts\` runs as C++; \`App.tsx\` calls it like any function.
- \`src/device.lucent.ts\` calls UIKit on iOS and \`android.os\` on Android.
- Add a module with \`npx lucent new module <name>\`; \`npx lucent dev\` rebuilds as you edit.
${extra}`;

/** Files of `dir`, recursively, relative to it. */
function walk(dir: string, at = ""): string[] {
  return fs
    .readdirSync(path.join(dir, at), { withFileTypes: true })
    .flatMap((e) => (e.isDirectory() ? walk(dir, path.join(at, e.name)) : [path.join(at, e.name)]));
}

/** Files the bare template has under a placeholder name: `_gitignore` is `.gitignore` (npm drops dotfiles). */
const DOTFILE = /(^|[\\/])_(gitignore|watchmanconfig|bundle|xcode\.env)(?=$|[\\/])/;
const BINARY = /\.(png|jar|keystore)$/;

/** React Native's bare template, named `name` (its iOS project, Android package and title). */
function bareNativeFiles(name: string, title: string): Map<string, Buffer | string> {
  const dir = packageFile("templates/bare");
  const lower = name.toLowerCase();
  const out = new Map<string, Buffer | string>();
  for (const rel of walk(dir)) {
    if (rel.startsWith("LICENSE")) continue;
    const to = rel
      .replace(DOTFILE, "$1.$2")
      .replaceAll("HelloWorld", name)
      .replaceAll("helloworld", lower);
    const content = fs.readFileSync(path.join(dir, rel));
    out.set(
      to,
      BINARY.test(rel)
        ? content
        : content
            .toString("utf8")
            .replaceAll("Hello App Display Name", title)
            .replaceAll("HelloWorld", name)
            .replaceAll("helloworld", lower),
    );
  }
  return out;
}

/** The files of `template` for a project in directory `name`, by path relative to it. */
export function projectFiles(
  template: ProjectTemplate,
  name: string,
): Map<string, Buffer | string> {
  const title = path.basename(name);
  const pkg = packageName(name);
  const app = appName(name);
  const files = new Map<string, Buffer | string>();

  if (template === "bare") {
    for (const [f, c] of bareNativeFiles(app, title)) files.set(f, c);
    files.set(
      "package.json",
      json({
        name: pkg,
        version: "0.0.1",
        private: true,
        scripts: {
          android: "react-native run-android",
          ios: "react-native run-ios",
          pods: "lucent build && cd ios && bundle exec pod install",
          start: "react-native start",
          lucent: "lucent build",
        },
        dependencies: {
          react: VERSIONS.react,
          "react-native": VERSIONS.reactNative,
          "react-native-safe-area-context": "^5.5.2",
        },
        devDependencies: {
          "@babel/core": "^7.25.2",
          "@babel/preset-env": "^7.25.3",
          "@babel/runtime": "^7.25.0",
          "@lucent-lang/lucent": lucentRange(),
          "@react-native-community/cli": VERSIONS.rnCli,
          "@react-native-community/cli-platform-android": VERSIONS.rnCli,
          "@react-native-community/cli-platform-ios": VERSIONS.rnCli,
          "@react-native/babel-preset": VERSIONS.rnTooling,
          "@react-native/metro-config": VERSIONS.rnTooling,
          "@react-native/typescript-config": VERSIONS.rnTooling,
          "@types/react": VERSIONS.typesReact,
          typescript: VERSIONS.typescript,
        },
        engines: { node: ">=22.12" },
      }),
    );
    files.set(
      "index.js",
      `import { AppRegistry } from "react-native";\nimport App from "./App";\nimport { name as appName } from "./app.json";\n\nAppRegistry.registerComponent(appName, () => App);\n`,
    );
    files.set("App.tsx", APP(title));
    for (const [f, c] of Object.entries(appModules())) files.set(f, c);
    files.set(
      "README.md",
      README(title, [
        "npm install",
        "npm run pods          # lucent build, then pod install in ios/",
        "npm run ios",
        "npm run android       # Gradle runs lucent build first",
      ]),
    );
    return files;
  }

  if (template === "module") {
    files.set(
      "package.json",
      json({
        name: pkg,
        version: "0.0.0",
        private: true,
        scripts: {
          build: "lucent build --platforms host",
          check: "lucent check",
          bench: "lucent bench",
        },
        devDependencies: { "@lucent-lang/lucent": lucentRange(), typescript: VERSIONS.typescript },
      }),
    );
    for (const t of ["function", "async", "events"] as const)
      for (const [f, c] of Object.entries(starterModule(t, t === "function" ? "hello" : t).files))
        files.set(f, c);
    files.set(
      "src/hello.bench.ts",
      `// lucent bench times each case natively and as JavaScript (it needs a desktop Hermes: HERMES_DIR).
import { hello } from "./hello.lucent";

export const cases = {
  hello: () => hello("Ada"),
};
`,
    );
    files.set(
      "tsconfig.json",
      json({
        compilerOptions: {
          strict: true,
          module: "esnext",
          moduleResolution: "bundler",
          target: "es2022",
          noEmit: true,
          noUncheckedIndexedAccess: true,
          paths: { "lucent:*": ["./.lucent/native/types/*"] },
          plugins: [{ name: "@lucent-lang/lucent/ts-plugin" }],
        },
      }),
    );
    files.set(".gitignore", "node_modules/\n.lucent/\n");
    files.set(
      "README.md",
      `# ${title}

[Lucent](https://lucent-lang.dev) modules on their own: TypeScript that compiles to C++, without an app.

\`\`\`sh
npm install
npx lucent build --platforms host   # compile to C++ for this machine
npx lucent check                    # type-check and validate the modules
npx lucent new module <name>        # add one: --template function|async|events|view|sdk-ios-android
\`\`\`

- \`src/hello.lucent.ts\`, \`src/async.lucent.ts\` and \`src/events.lucent.ts\` are the three kinds of export JavaScript calls.
- The C++ is in \`.lucent/native/cpp/generated/\`.
- To use them in an app, copy \`src/\` into one set up with \`npx lucent init\`, or start from \`npx @lucent-lang/lucent create <name> --template expo\`.
`,
    );
    return files;
  }

  if (template === "expo" || template === "view") {
    files.set(
      "package.json",
      json({
        name: pkg,
        version: "1.0.0",
        private: true,
        main: "index.ts",
        scripts: {
          start: "expo start --dev-client",
          ios: "expo run:ios",
          android: "expo run:android",
          lucent: "lucent build",
        },
        dependencies: {
          expo: VERSIONS.expo,
          "expo-dev-client": VERSIONS.expoDevClient,
          "expo-status-bar": VERSIONS.expoStatusBar,
          react: VERSIONS.react,
          "react-native": VERSIONS.expoReactNative,
        },
        devDependencies: {
          "@lucent-lang/lucent": lucentRange(),
          "@types/react": VERSIONS.typesReact,
          typescript: VERSIONS.typescript,
        },
      }),
    );
    files.set(
      "app.json",
      json({
        expo: {
          name: title,
          slug: pkg,
          version: "1.0.0",
          newArchEnabled: true,
          ios: { bundleIdentifier: `com.${app.toLowerCase()}` },
          android: { package: `com.${app.toLowerCase()}` },
          plugins: [],
        },
      }),
    );
    // A development build: Expo Go can't load Lucent's native code.
    files.set(
      "eas.json",
      json({
        cli: { appVersionSource: "remote" },
        build: {
          development: {
            developmentClient: true,
            distribution: "internal",
            env: { LUCENT_CACHE_DIR: "./.lucent-cache" },
            cache: { paths: [".lucent-cache"] },
          },
          production: {
            env: { LUCENT_CACHE_DIR: "./.lucent-cache" },
            cache: { paths: [".lucent-cache"] },
          },
        },
      }),
    );
    files.set(
      "index.ts",
      `import { registerRootComponent } from "expo";\nimport App from "./App";\n\nregisterRootComponent(App);\n`,
    );
    files.set(
      "tsconfig.json",
      json({ extends: "expo/tsconfig.base", compilerOptions: { strict: true } }),
    );
    files.set(
      ".gitignore",
      "node_modules/\n.expo/\ndist/\n# Generated by expo prebuild\n/ios\n/android\n.lucent-cache/\n",
    );
    if (template === "view") {
      for (const [f, c] of Object.entries(starterModule("view", "badge").files)) files.set(f, c);
      for (const [f, c] of Object.entries(starterModule("function", "hello").files))
        files.set(f, c);
      files.set("App.tsx", VIEW_APP);
    } else {
      files.set("App.tsx", APP(title));
      for (const [f, c] of Object.entries(appModules())) files.set(f, c);
    }
    files.set(
      "README.md",
      README(
        title,
        [
          "npm install",
          "npx expo run:ios      # or run:android: a development build",
          "npx expo start --dev-client",
        ],
        "\nExpo Go can't run Lucent's native code: use a development build (`expo run:*`, or `eas build --profile development`).\n",
      ),
    );
    return files;
  }

  // A library: a Lucent package, and an Expo app that uses it.
  const module = "device";
  files.set(
    "package.json",
    json({
      name: pkg,
      version: "0.1.0",
      description: `${title}: native modules for React Native, written with Lucent`,
      license: "MIT",
      main: "index.ts",
      types: "index.ts",
      files: ["index.ts", "src", "README.md"],
      keywords: ["react-native", "lucent"],
      lucent: { sources: "src", compatible: lucentRange() },
      peerDependencies: { "@lucent-lang/lucent": lucentRange(), "react-native": "*" },
      devDependencies: { "@lucent-lang/lucent": lucentRange(), typescript: VERSIONS.typescript },
      scripts: { check: "lucent check", prepublishOnly: "lucent check" },
    }),
  );
  files.set(
    "index.ts",
    `// The package's API: its Lucent modules, which an app's Metro turns into their proxies.\nexport * from "./src/${module}.lucent";\nexport * from "./src/hello.lucent";\n`,
  );
  files.set(`src/${module}.lucent.ts`, platformSource(module, ["ios", "android"], "greeting"));
  for (const [f, c] of Object.entries(starterModule("function", "hello").files)) files.set(f, c);
  files.set(
    "tsconfig.json",
    json({
      compilerOptions: {
        strict: true,
        noUncheckedIndexedAccess: true,
        module: "esnext",
        moduleResolution: "bundler",
        target: "es2022",
        noEmit: true,
        paths: { "lucent:*": ["./.lucent/native/types/*"] },
        plugins: [{ name: "@lucent-lang/lucent/ts-plugin" }],
      },
      exclude: ["example"],
    }),
  );
  files.set(
    ".gitignore",
    "node_modules/\n.lucent/\nexample/.lucent/\nexample/ios/\nexample/android/\n",
  );
  files.set(".npmignore", "example/\n.lucent/\n");
  files.set(
    "README.md",
    `# ${pkg}

Native modules for React Native, written in TypeScript with [Lucent](https://lucent-lang.dev).

## Use it

\`\`\`sh
npm install ${pkg} @lucent-lang/lucent
npx lucent init
\`\`\`

\`\`\`ts
import { greeting, hello } from "${pkg}";

hello("Ada");               // "Hello, Ada, from native code"
await greeting("Ada");      // "Hello, Ada, from iOS 18.0", on each platform's SDK
\`\`\`

The app compiles this package's modules into its own native code when it builds: rebuild the app after installing or upgrading it. Expo Go can't run it.

## Develop it

\`\`\`sh
npm install
npx lucent check          # this package's modules
cd example && npm install && npx expo run:ios
\`\`\`

- \`src/${module}.lucent.ts\` and \`src/hello.lucent.ts\` are the package's modules; \`lucent.sources\` in \`package.json\` names \`src/\`.
- \`lucent.compatible\` is the range of Lucent versions the package is tested with: raise it when you test a new one.
- \`example/\` is an Expo app that depends on this package from its directory.

## Publish it

\`\`\`sh
npx lucent check && npm publish
\`\`\`
`,
  );
  files.set(
    "example/package.json",
    json({
      name: `${pkg.replace(/^@[^/]+\//, "")}-example`,
      version: "1.0.0",
      private: true,
      main: "index.ts",
      scripts: {
        start: "expo start --dev-client",
        ios: "expo run:ios",
        android: "expo run:android",
      },
      dependencies: {
        [pkg]: "file:..",
        expo: VERSIONS.expo,
        "expo-dev-client": VERSIONS.expoDevClient,
        react: VERSIONS.react,
        "react-native": VERSIONS.expoReactNative,
      },
      devDependencies: {
        "@lucent-lang/lucent": lucentRange(),
        "@types/react": VERSIONS.typesReact,
        typescript: VERSIONS.typescript,
      },
    }),
  );
  files.set(
    "example/app.json",
    json({
      expo: {
        name: `${title} example`,
        slug: `${pkg.replace(/^@[^/]+\//, "")}-example`,
        newArchEnabled: true,
        ios: { bundleIdentifier: `com.${app.toLowerCase()}.example` },
        android: { package: `com.${app.toLowerCase()}.example` },
        plugins: [],
      },
    }),
  );
  files.set(
    "example/index.ts",
    `import { registerRootComponent } from "expo";\nimport App from "./App";\n\nregisterRootComponent(App);\n`,
  );
  files.set(
    "example/App.tsx",
    APP(title).replace(
      'import { hello } from "./src/hello.lucent";\nimport { greeting } from "./src/device.lucent";',
      `import { greeting, hello } from "${pkg}";`,
    ),
  );
  files.set(
    "example/tsconfig.json",
    json({ extends: "expo/tsconfig.base", compilerOptions: { strict: true } }),
  );
  files.set(
    "example/metro.config.js",
    `const path = require("path");\nconst { getDefaultConfig } = require("expo/metro-config");\n\nconst config = getDefaultConfig(__dirname);\n// The package, one directory up: Metro watches it, and resolves its imports from here.\nconfig.watchFolders = [path.resolve(__dirname, "..")];\nconfig.resolver.nodeModulesPaths = [path.resolve(__dirname, "node_modules")];\n\nmodule.exports = config;\n`,
  );
  files.set("example/.gitignore", "node_modules/\n.expo/\n/ios\n/android\n");
  return files;
}

/**
 * Writes `template`'s project into `dir` (which must not exist, or be
 * empty), then sets the apps up for Lucent as `lucent init --yes` does:
 * the library's example app too. Returns the files written, relative to `dir`.
 */
export function writeProject(template: ProjectTemplate, dir: string, name: string): string[] {
  const files = projectFiles(template, name);
  for (const [rel, content] of files) {
    const to = path.join(dir, rel);
    fs.mkdirSync(path.dirname(to), { recursive: true });
    fs.writeFileSync(to, content);
    if (rel === "android/gradlew") fs.chmodSync(to, 0o755);
  }
  const written = new Set(files.keys());
  // Modules alone have no app to set up: just their tsconfig's lucent:* path.
  const apps = template === "library" ? ["example"] : template === "module" ? [] : ["."];
  for (const app of apps) {
    const root = path.join(dir, app);
    // init's first module is for apps without any: the library's example uses the library's.
    const plan = planInit(root);
    plan.changes = plan.changes.filter((c) => !c.file.endsWith(".lucent.ts"));
    applyChanges(root, plan.changes);
    for (const c of plan.changes) written.add(path.join(app, c.file));
  }
  return [...written].map((f) => f.split(path.sep).join("/")).sort();
}
