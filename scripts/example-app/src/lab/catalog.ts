import type { ComponentType } from "react";
import { BenchLab } from "./bench/BenchLab";
import { CompareLab } from "./compare/CompareLab";
import { SdkLab } from "./sdk/SdkLab";
import { TestsLab } from "./tests/TestsLab";

export interface LabEntry {
  /** Its route: lab/<id>. The old -lucentTab names. */
  id: string;
  title: string;
  summary: string;
  Screen: ComponentType;
}

export const lab: readonly LabEntry[] = [
  {
    id: "tests",
    title: "Differential tests",
    summary: "Every end-to-end case, natively, against the same code run as JavaScript.",
    Screen: TestsLab,
  },
  {
    id: "sdk",
    title: "Platform probes",
    summary: "Lucent modules calling the iOS and Android SDKs, and the packages they port.",
    Screen: SdkLab,
  },
  {
    id: "bench",
    title: "Benchmark",
    summary: "Compute kernels compiled by Lucent against the same TypeScript in Hermes.",
    Screen: BenchLab,
  },
  {
    id: "compare",
    title: "Compare",
    summary: "NitroBenchmarks: Lucent next to Turbo, Nitro and Expo modules.",
    Screen: CompareLab,
  },
];
