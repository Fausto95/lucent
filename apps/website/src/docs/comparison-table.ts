/**
 * Lucent vs Expo Modules vs Nitro vs Turbo Native Modules, shared by
 * /docs/comparison/ and the homepage summary. Sources and the date they
 * were checked are on the comparison page.
 */
export const tools = [
  { id: "lucent", name: "Lucent" },
  { id: "expo", name: "Expo Modules" },
  { id: "nitro", name: "Nitro Modules" },
  { id: "turbo", name: "Turbo Native Modules" },
] as const;

export type ToolId = (typeof tools)[number]["id"];

/** available: usable today · partial: usable with limits · planned: not yet. */
export type Tone = "available" | "partial" | "planned";

export interface ComparisonCell {
  /** A few words, scannable across the row. */
  value: string;
  /** Context in the docs' inline markup; hidden in the compact table. */
  detail?: string;
  tone?: Tone;
}

export interface ComparisonRow {
  label: string;
  /** Shown in the homepage's compact table. */
  summary?: boolean;
  cells: Record<ToolId, ComparisonCell>;
}

export const comparisonRows: ComparisonRow[] = [
  {
    label: "You write",
    summary: true,
    cells: {
      lucent: { value: "A TypeScript subset", detail: "`*.lucent.ts`, compiled to C++20" },
      expo: { value: "Swift + Kotlin" },
      nitro: { value: "C++, or Swift + Kotlin", detail: "Swift and Kotlin each cover one platform" },
      turbo: { value: "Obj-C++ + Java/Kotlin, or C++", detail: "Swift needs Objective-C++ glue" },
    },
  },
  {
    label: "Interface defined by",
    cells: {
      lucent: { value: "The implementation", detail: "its exported functions, types and classes" },
      expo: { value: "A Swift/Kotlin DSL", detail: "the module definition" },
      nitro: { value: "A TypeScript spec", detail: "`*.nitro.ts`; Nitrogen (optional) generates the native interfaces" },
      turbo: { value: "A TS or Flow spec", detail: "Codegen generates the native interfaces" },
    },
  },
  {
    label: "Codebases per module",
    summary: true,
    cells: {
      lucent: { value: "1" },
      expo: { value: "2" },
      nitro: { value: "1 or 2", detail: "1 in C++; plus the spec" },
      turbo: { value: "2, or 1 in C++", detail: "C++ still needs a small platform registration layer; plus the spec" },
    },
  },
  {
    label: "Call path",
    cells: {
      lucent: { value: "JSI → C++", detail: "one pure C++ TurboModule" },
      expo: { value: "JSI", detail: "through Expo's module layer" },
      nitro: { value: "JSI → C++", detail: "Hybrid Objects on `jsi::NativeState`; Swift and Kotlin through generated bridges" },
      turbo: { value: "JSI", detail: "C++ modules directly, others through the platform interop layer" },
    },
  },
  {
    label: "Platform SDKs",
    summary: true,
    cells: {
      lucent: {
        value: "Most",
        tone: "partial",
        detail: "typed from your Xcode and Android SDK; some gaps, such as Android generics. See [SDK types](/docs/reference/platform-types/)",
      },
      expo: { value: "Full", tone: "available" },
      nitro: { value: "Full", tone: "available" },
      turbo: { value: "Full", tone: "available" },
    },
  },
  {
    label: "Views",
    summary: true,
    cells: {
      lucent: { value: "Planned", tone: "planned", detail: "milestone M3" },
      expo: { value: "Yes", tone: "available", detail: "`View` in the module definition" },
      nitro: { value: "Yes", tone: "available", detail: "Nitro Views; React Native 0.78+, New Architecture" },
      turbo: { value: "Yes", tone: "available", detail: "Fabric Native Components, a separate API" },
    },
  },
  {
    label: "Bare React Native / Expo",
    cells: {
      lucent: { value: "Both", tone: "available", detail: "React Native 0.88, Expo SDK 58" },
      expo: { value: "Both", tone: "available", detail: "bare apps install the `expo` package" },
      nitro: { value: "Both", tone: "available", detail: "React Native 0.75+" },
      turbo: { value: "Both", tone: "available" },
    },
  },
  {
    label: "Maturity",
    summary: true,
    cells: {
      lucent: { value: "Experimental", tone: "partial", detail: "see the [roadmap](/docs/roadmap/)" },
      expo: { value: "Production", tone: "available", detail: "the Expo SDK is built on it" },
      nitro: { value: "Pre-1.0", tone: "partial", detail: "0.37 at the time of writing; used by published libraries" },
      turbo: { value: "Production", tone: "available", detail: "part of React Native core" },
    },
  },
];
