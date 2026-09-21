/** Native implementations are trusted build inputs; the compiler never executes them. */
export type ThreadContext = "caller" | "main" | "worker";
export interface NativeBinding {
  swift: string[];
  kotlin: string[];
  swiftImports?: string[];
  kotlinImports?: string[];
  capabilities?: string[];
  thread?: ThreadContext;
}
export interface LibraryModule {
  source: string;
  bindings?: Record<string, NativeBinding>;
}
export const STANDARD_LIBRARIES: Readonly<Record<string, LibraryModule>> = {
  "@lucent-lang/std/math": {
    source:
      ["abs", "sqrt", "floor", "ceil", "sin", "cos"]
        .map((name) => `export declare function ${name}(value: number): number;`)
        .join("\n") +
      "\nexport declare function min(a: number, b: number): number;\nexport declare function max(a: number, b: number): number;",
    bindings: {
      abs: { swift: ["return Swift.abs(value)"], kotlin: ["return kotlin.math.abs(value)"] },
      sqrt: { swift: ["return value.squareRoot()"], kotlin: ["return kotlin.math.sqrt(value)"] },
      floor: { swift: ["return value.rounded(.down)"], kotlin: ["return kotlin.math.floor(value)"] },
      ceil: { swift: ["return value.rounded(.up)"], kotlin: ["return kotlin.math.ceil(value)"] },
      sin: {
        swift: ["return Foundation.sin(value)"],
        kotlin: ["return kotlin.math.sin(value)"],
        swiftImports: ["Foundation"],
      },
      cos: {
        swift: ["return Foundation.cos(value)"],
        kotlin: ["return kotlin.math.cos(value)"],
        swiftImports: ["Foundation"],
      },
      min: { swift: ["return Swift.min(a, b)"], kotlin: ["return kotlin.math.min(a, b)"] },
      max: { swift: ["return Swift.max(a, b)"], kotlin: ["return kotlin.math.max(a, b)"] },
    },
  },
  "@lucent-lang/std/text": {
    source:
      "export declare function trim(value: string): string;\nexport declare function contains(value: string, search: string): boolean;",
    bindings: {
      trim: {
        swift: ["return value.trimmingCharacters(in: .whitespacesAndNewlines)"],
        kotlin: ["return value.trim()"],
        swiftImports: ["Foundation"],
      },
      contains: { swift: ["return value.contains(search)"], kotlin: ["return value.contains(search)"] },
    },
  },
  "@lucent-lang/platform/clock": {
    source: "export declare function now(): number;",
    bindings: {
      now: {
        swift: ["return Date().timeIntervalSince1970 * 1000"],
        kotlin: ["return System.currentTimeMillis().toDouble()"],
        swiftImports: ["Foundation"],
        capabilities: ["clock"],
      },
    },
  },
  "@lucent-lang/platform/locale": {
    source: "export declare function languageTag(): string;",
    bindings: {
      languageTag: {
        swift: ['return Locale.current.identifier.replacingOccurrences(of: "_", with: "-")'],
        kotlin: ["return java.util.Locale.getDefault().toLanguageTag()"],
        swiftImports: ["Foundation"],
        capabilities: ["locale"],
      },
    },
  },
};
