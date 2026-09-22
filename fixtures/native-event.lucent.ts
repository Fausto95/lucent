import { event } from "@lucent-lang/core/events";
export type Progress = { percent: number; label: string };
export const progress = event<Progress>();
export function report(percent: number): void { progress.emit({percent, label: "native"}); }
