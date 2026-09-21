import type { int32 } from "@lucent/types";

type Stats = { count: int32; labels: Record<string, string>; values: number[] };

function label(stats: Stats, key: string): string {
  const found = stats.labels[key];
  if (found !== undefined) {
    return found;
  }
  return "none";
}

export function summarize(stats: Stats, key: string, verbose: boolean): string {
  let out = label(stats, key);
  let i: int32 = 0;
  while (i < stats.count) {
    out += "!";
    i++;
  }
  const evens: number[] = [];
  for (const v of stats.values) {
    if (v % 2 === 0 && v > 0) {
      evens.push(v);
    } else if (v < 0) {
      break;
    } else {
      continue;
    }
  }
  if (!verbose || evens.length === 0) {
    return out;
  }
  return `${out} ${evens.length} ${-i}`;
}
