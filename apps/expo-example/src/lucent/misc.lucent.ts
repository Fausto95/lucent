import { utf8Decode, utf8Encode } from "lucent:core";

export enum Color {
  Red = "red",
  Green = "green",
}

export enum Level {
  Low,
  High = 10,
}

export function colorName(c: Color): string {
  return c === Color.Red ? "warm" : "cool";
}

export function level(l: Level): number {
  return l + 1;
}

export const VERSION = "1.2.3";
export const LIMITS = { min: 1, max: 9 };

export function checksum(bytes: Uint8Array): number {
  let sum = 0;
  for (const b of bytes) sum = (sum + b) % 256;
  return sum;
}

export function bytesOps(n: number): Uint8Array {
  const b = new Uint8Array(n);
  for (let i = 0; i < n; i++) b[i] = i * 100;
  return b.subarray(1);
}

export function roundTrip(s: string): string {
  const bytes = utf8Encode(s);
  return `${bytes.length}:${utf8Decode(bytes)}`;
}

type Config = { name: string; retries?: number; nested?: { deep?: string } };

export function optional(c: Config): string {
  const retries = c.retries ?? 3;
  const deep = c.nested?.deep?.length ?? -1;
  return `${c.name} ${retries} ${deep}`;
}

export function jsonOut(): string {
  const data = { a: [1, 2, { b: "c" }], d: undefined, e: null, f: true };
  void data;
  return JSON.stringify({ list: [1.5, -0, 1e21], name: 'q"x', flag: false });
}

export function counterKeys(text: string): string {
  const counts: Record<string, number> = {};
  for (const ch of text) counts[ch] = (counts[ch] ?? 0) + 1;
  return JSON.stringify(counts);
}
