import type { Block } from "../types";
import { greetProxy } from "../../generated/proxy-demo";

export const blocks: Block[] = [
  {
    kind: "steps",
    steps: [
      {
        title: "The TypeScript checker checks your module",
        blocks: [
          { kind: "diagram", diagram: "build-check" },
          {
            kind: "p",
            text: "Lucent runs the real TypeScript compiler, in strict mode with `noUncheckedIndexedAccess`. Every type comes from the checker, including narrowing, so your editor and `lucent build` see the same types.",
          },
          {
            kind: "p",
            text: "Then Lucent applies its own rules: no `any`, no `var`, no dynamic property access. Breaking one stops the build with a `LUCENT` code, and nothing is written. The [diagnostics](/docs/reference/diagnostics/) list every code.",
          },
        ],
      },
      {
        title: "Lucent writes C++",
        blocks: [
          { kind: "diagram", diagram: "build-cpp" },
          {
            kind: "code",
            filename: "greet.lucent.ts",
            cpp: true,
            code: `export function greet(name: string): string {
  const trimmed = name.trim();
  return trimmed.length > 0 ? \`Hello, \${trimmed}!\` : "Hello, stranger!";
}`,
          },
          {
            kind: "p",
            text: "Each module becomes one C++ file and one header. The `#line` directives point back to your source, so compiler errors, the debugger and crash reports name `.lucent.ts` lines.",
          },
          {
            kind: "p",
            text: "The C++ keeps JavaScript's behavior. A `number` is a `double` with JavaScript's arithmetic, strings are UTF-16, and objects are shared by reference. The few [differences](/docs/reference/language/#differences-from-javascript) are listed.",
          },
        ],
      },
      {
        title: "`lucent build` writes the native package",
        blocks: [
          { kind: "diagram", diagram: "build-package" },
          {
            kind: "table",
            head: ["In `.lucent/`", "What it holds"],
            rows: [
              [
                "`native/cpp/lucent/`, `native/cpp/rn/`",
                "The C++ runtime, and `Lucent`, the one TurboModule that serves every module.",
              ],
              [
                "`native/cpp/generated/`",
                "Your modules' C++, with a folder per platform when a module has platform code.",
              ],
              [
                "`native/LucentNative.podspec`, `native/ios/`",
                "The CocoaPods spec, and the iOS registration.",
              ],
              ["`native/android/`", "The CMake project, the Gradle file and the Android manifest."],
              ["`native/js/`", "One proxy per module, and the loader they share."],
              ["`native/types/`", "Declarations of the `lucent:*` imports, for your editor."],
              ["`native/manifest.json`", "The module list, and a hash of the build's inputs."],
              [
                "`check.json`, `android-classpath*.json`",
                "What `lucent check` and the Android dependency step remember between runs.",
              ],
            ],
          },
          {
            kind: "p",
            text: "`.lucent/` is generated, so keep it out of git. When nothing changed, `lucent build` returns at once. Otherwise it rewrites only the files whose content changed.",
          },
        ],
      },
      {
        title: "Your app build compiles it",
        blocks: [
          { kind: "diagram", diagram: "build-app" },
          {
            kind: "p",
            text: "Autolinking finds the native package through the `lucent` entry in `react-native.config.js`. On iOS, CocoaPods compiles it, and it registers itself with React Native when the app loads. On Android, Gradle adds its CMake project to the app's native build.",
          },
          {
            kind: "p",
            text: "Either way, one C++ TurboModule named `Lucent` serves every module. There's no codegen step, and no Swift or Kotlin.",
          },
          {
            kind: "note",
            tone: "warn",
            text: "The C++ is part of the app binary. After a change, rebuild the app; when modules were added or removed, run `pod install` first.",
          },
        ],
      },
      {
        title: "Metro swaps the import for a proxy",
        blocks: [
          { kind: "diagram", diagram: "build-metro" },
          { kind: "code", filename: ".lucent/native/js/greet.js", code: greetProxy },
          {
            kind: "p",
            text: "Your editor and `tsc` read the `.lucent.ts` source, so the import is typed. Metro bundles this proxy instead, so none of the module's code is in the JS bundle.",
          },
          {
            kind: "p",
            text: "If the module was never built, the proxy throws `Lucent: greet.lucent.ts has not been compiled`. Run `lucent build`, then rebuild the app.",
          },
        ],
      },
    ],
  },
];
