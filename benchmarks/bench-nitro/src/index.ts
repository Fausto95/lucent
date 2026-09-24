import { NitroModules } from "react-native-nitro-modules";
import type { Bench, BenchCxx } from "./specs/Bench.nitro";

export const BenchNitro = NitroModules.createHybridObject<Bench>("Bench");
export const BenchNitroCxx = NitroModules.createHybridObject<BenchCxx>("BenchCxx");
