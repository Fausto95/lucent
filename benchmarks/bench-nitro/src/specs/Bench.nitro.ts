import type { HybridObject } from "react-native-nitro-modules";

/** NitroBenchmarks' MyModule: implemented in Swift (iOS) and Kotlin (Android). */
export interface Bench extends HybridObject<{ ios: "swift"; android: "kotlin" }> {
  addNumbers(a: number, b: number): number;
  addStrings(a: string, b: string): string;
}

/** NitroBenchmarks' MyCxxModule: implemented in C++ on both platforms. */
export interface BenchCxx extends HybridObject<{ ios: "c++"; android: "c++" }> {
  addNumbers(a: number, b: number): number;
  addStrings(a: string, b: string): string;
}
