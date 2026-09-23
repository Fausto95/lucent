import type { Block } from "./types";

type Table = Extract<Block, { kind: "table" }>;

/** The comparison, shared by /docs/comparison/ and the homepage summary. Sources are on the comparison page. */
export const comparisonTable: Table = {
  kind: "table",
  head: ["", "Lucent", "Expo Modules", "Nitro Modules", "Turbo Native Modules"],
  rows: [
    [
      "You write the implementation in",
      "A checked TypeScript subset (`*.lucent.ts`), compiled to C++20",
      "Swift and Kotlin",
      "C++, or Swift (iOS) and Kotlin (Android)",
      "Objective-C++ (Swift possible behind Objective-C++ glue) and Java or Kotlin; or C++ for both platforms",
    ],
    [
      "Interface to JavaScript defined by",
      "The implementation itself: its exported functions, types and classes",
      "The module definition DSL in Swift and Kotlin",
      "A TypeScript spec (`*.nitro.ts`); Nitrogen, an optional code generator, turns it into C++, Swift and Kotlin interfaces",
      "A TypeScript or Flow spec; Codegen turns it into native interfaces",
    ],
    [
      "Codebases per module",
      "1",
      "2",
      "1 (C++) or 2 (Swift and Kotlin), plus the TypeScript spec",
      "2, or 1 in C++ plus a small platform registration layer; plus the spec",
    ],
    [
      "Call path",
      "JSI → one pure C++ TurboModule → generated C++",
      "JSI, through Expo's module layer",
      "JSI → C++ Hybrid Objects (`jsi::NativeState`); Swift and Kotlin through generated bridges",
      "JSI (New Architecture); C++ modules directly, others through the platform interop layer",
    ],
    [
      "Platform SDKs",
      "Early: Android bindings generated from `android.jar`; iOS a hand-written UIKit subset. See [Platform APIs](/docs/platform-apis/)",
      "Full, from Swift and Kotlin",
      "Full, from Swift and Kotlin (or C++)",
      "Full, from the native languages",
    ],
    [
      "Views",
      "Planned (M3)",
      "Yes (`View` in the module definition)",
      "Yes: Nitro Views, Swift and Kotlin, React Native 0.78+ with the New Architecture",
      "Yes, through a separate API: Fabric Native Components",
    ],
    [
      "Expo / bare React Native",
      "Both (tested on React Native 0.88 and Expo SDK 58)",
      "Both; a bare app installs the `expo` package",
      "Both (React Native 0.75+)",
      "Both",
    ],
    [
      "Maturity",
      "Experimental. See [Status](/docs/status/)",
      "Production; the Expo SDK's own packages are built on it",
      "Pre-1.0 (0.37 at the time of writing), used by published libraries",
      "Production; part of React Native core",
    ],
  ],
};

const summaryRows = new Set(["You write the implementation in", "Codebases per module", "Platform SDKs", "Maturity"]);

export const comparisonSummary: Table = {
  ...comparisonTable,
  rows: comparisonTable.rows.filter(([label]) => summaryRows.has(label!)),
};
