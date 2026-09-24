import { requireNativeModule } from "expo";

export const BenchExpo = requireNativeModule<{
  addNumbers(a: number, b: number): number;
  addStrings(a: string, b: string): string;
}>("BenchExpo");
