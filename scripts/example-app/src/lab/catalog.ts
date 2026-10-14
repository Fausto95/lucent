import type { ComponentType } from "react";
import { BenchLab } from "./bench/BenchLab";
import { CompareLab } from "./compare/CompareLab";
import { LibrariesLab } from "./libraries/LibrariesLab";
import { MediaLab } from "./media/MediaLab";
import { PlatformLab } from "./platform/PlatformLab";
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
    id: "platform",
    title: "Platform events",
    summary:
      "Frames through an executor, deep links, push tokens and back presses, as only the platform gives them.",
    Screen: PlatformLab,
  },
  {
    id: "media",
    title: "Media service",
    summary: "A foreground service written in Lucent, which outlives the Activity that started it.",
    Screen: MediaLab,
  },
  {
    id: "libraries",
    title: "View libraries",
    summary: "A Lucent component animated by Reanimated, under Gesture Handler, in a native stack.",
    Screen: LibrariesLab,
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
