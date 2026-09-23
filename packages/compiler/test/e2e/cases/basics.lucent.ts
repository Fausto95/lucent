export function hash(input: string, seed: number = 0): number {
  let h = seed | 0;
  for (let i = 0; i < input.length; i++) {
    h = Math.imul(h ^ input.charCodeAt(i), 0x5bd1e995);
    h ^= h >>> 15;
  }
  return h >>> 0;
}

export async function hashMany(inputs: string[]): Promise<number[]> {
  return inputs.map((s) => hash(s));
}

export function clamp(v: number, lo: number, hi: number): number {
  return Math.min(Math.max(v, lo), hi);
}

export function describe(n: number): string {
  if (n < 0) return "negative";
  else if (n === 0) return "zero";
  return `positive ${n}`;
}
